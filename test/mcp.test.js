import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = new URL('../bin/logclump.js', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
function mcp(cwd, messages) {
  const input = messages.map((m) => JSON.stringify({ jsonrpc: '2.0', ...m })).join('\n') + '\n';
  const r = spawnSync(process.execPath, [BIN, '--mcp'], { cwd, input, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  return { byId: Object.fromEntries(r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((x) => [x.id, x])), raw: r.stdout };
}
const call = (id, args) => ({ id, method: 'tools/call', params: { name: 'logclump_summarize', arguments: args } });
const LOG = 'ERROR login failed for bob@corp.com from 10.1.2.3\nERROR login failed for amy@corp.com from 10.9.9.9\nWARN disk 91% full\nERROR token sk_live_ABC123def456GHI789jkl rejected\n';

test('MCP: handshake and tool list', () => {
  const { byId } = mcp(tmpdir(), [{ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, { id: 2, method: 'tools/list' }]);
  assert.equal(byId[1].result.serverInfo.name, 'logclump');
  const [t] = byId[2].result.tools;
  assert.equal(t.name, 'logclump_summarize'); assert.equal(t.annotations.readOnlyHint, true);
  assert.equal(t.run, undefined); assert.equal(t.validate, undefined);
});

test('MCP: summarizes files and text, output masked', () => {
  const d = mkdtempSync(join(tmpdir(), 'logclump-mcp-'));
  writeFileSync(join(d, 'app.log'), LOG);
  const { byId, raw } = mcp(d, [call(1, { files: ['app.log'] }), call(2, { text: LOG, level: 'warn', top: 1 })]);
  const r = byId[1].result.structuredContent;
  assert.equal(r.groups[0].count, 2); assert.equal(r.groups[0].signature, 'login failed for <email> from <ip>');
  assert.equal(byId[2].result.structuredContent.groups.length, 1);
  assert.equal(byId[2].result.structuredContent.totalGroups, 3);
  assert.doesNotMatch(raw, /bob@corp|10\.1\.2\.3|sk_live_ABC/);
});

test('MCP: refuses outside paths and bad arguments', () => {
  const { byId } = mcp(mkdtempSync(join(tmpdir(), 'logclump-mcp-')), [
    call(1, { files: ['../../etc/passwd'] }), call(2, { files: ['--fail'] }), call(3, {}),
    call(4, { files: ['a.log'], text: 'x' }), call(5, { level: 'loud', text: 'x' }), call(6, { top: -1, text: 'x' }), call(7, { rm: true }),
  ]);
  const msg = (id) => byId[id].result.content[0].text;
  assert.match(msg(1), /outside the project folder/); assert.match(msg(2), /invalid path/); assert.match(msg(3), /pass "files" or "text"/);
  assert.match(msg(4), /not both/); assert.match(msg(5), /must be one of/); assert.match(msg(6), /whole number/); assert.match(msg(7), /unknown argument/);
  for (const id of [1, 2, 3, 4, 5, 6, 7]) assert.equal(byId[id].result.isError, true);
});
