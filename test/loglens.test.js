import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalize, parseLine, analyze, printable } from '../src/index.js';

const BIN = new URL('../bin/loglens.js', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const run = (args, input) => spawnSync(process.execPath, [BIN, ...args], { input, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
const tmp = (name, content) => { const d = mkdtempSync(join(tmpdir(), 'loglens-')); const p = join(d, name); writeFileSync(p, content); return p; };

test('normalize masks variable data', () => {
  assert.equal(normalize('Timeout after 3000ms on 10.0.0.12:5432 for user bob@example.com'), 'Timeout after <n>ms on <ip> for user <email>');
  assert.equal(normalize('Order 9f1c2a3b-1111-4222-8333-444455556666 failed at 2026-11-21T10:00:00Z'), 'Order <uuid> failed at <time>');
  assert.equal(normalize('GET https://api.x.com/v1/users?token=abc 500'), 'GET <url> <n>');
  assert.equal(normalize('auth failed key=sk_live_51Habc123DEF456ghi789'), 'auth failed key=<token>');
  assert.equal(normalize('User "alice" not found, KeyError: \'user_id\''), 'User "<str>" not found, KeyError: \'<str>\'');
  assert.equal(normalize("can't connect, don't retry"), "can't connect, don't retry");
  assert.equal(normalize('at /app/src/db.js:42 ptr 0xdeadbeef commit 3f2a9c1b7e4d'), 'at /app/src/db.js:<n> ptr <hex> commit <hex>');
});

test('parseLine handles plain, bracketed, logfmt and JSON lines', () => {
  assert.deepEqual(parseLine('2026-11-21 10:00:01,123 ERROR db: connection lost'), { level: 'error', time: new Date('2026-11-21T10:00:01.123').toISOString(), message: 'db: connection lost' });
  assert.equal(parseLine('[2026-11-21T10:00:01Z] [WARN] disk 91% full').level, 'warn');
  assert.equal(parseLine('2026/11/21 10:00:01 [error] 12#0: upstream timed out').message, '12#0: upstream timed out');
  const lf = parseLine('time=2026-11-21T10:00:01Z level=error msg="payment failed id=7" code=500');
  assert.equal(lf.level, 'error'); assert.equal(lf.message, 'payment failed id=7');
  const pino = parseLine('{"level":50,"time":1763719201000,"msg":"query failed"}');
  assert.deepEqual(pino, { level: 'error', time: '2025-11-21T10:00:01.000Z', message: 'query failed' });
  assert.equal(parseLine('{"severity":"WARNING","message":"slow"}').level, 'warn');
  assert.equal(parseLine('{"level":"error","err":{"message":"boom"}}').message, 'boom');
  assert.equal(parseLine('INFO retrying after error').level, 'info');
});

test('stack frames are skipped, exception lines count as errors', () => {
  assert.equal(parseLine('    at Object.<anonymous> (/app/x.js:1:1)'), null);
  assert.equal(parseLine('Traceback (most recent call last):'), null);
  assert.equal(parseLine(''), null);
  assert.equal(parseLine('ValueError: invalid literal for int()').level, 'error');
  assert.equal(parseLine('DeprecationWarning: old api').level, 'warn');
});

test('analyze groups similar lines with first and last seen', () => {
  const r = analyze([
    '2026-11-21T10:00:00Z ERROR timeout after 3000ms',
    '2026-11-21T10:00:05Z INFO all good',
    '2026-11-21T10:01:00Z ERROR timeout after 5000ms',
    '2026-11-21T10:02:00Z ERROR disk full',
    '2026-11-21T10:03:00Z ERROR timeout after 100ms',
  ]);
  assert.equal(r.lines, 5); assert.equal(r.matched, 4); assert.equal(r.groups.length, 2);
  assert.deepEqual(r.groups[0], { level: 'error', signature: 'timeout after <n>ms', count: 3, first: { line: 1, time: '2026-11-21T10:00:00.000Z' }, last: { line: 5, time: '2026-11-21T10:03:00.000Z' } });
  assert.equal(analyze(['WARN a', 'ERROR b'], { minLevel: 'warn' }).groups.length, 2);
});

test('hostile input stays fast and terminal-safe', () => {
  const t = Date.now();
  normalize('a'.repeat(65536)); normalize('x'.repeat(65536) + '@'); normalize('"'.repeat(65536)); normalize('1.'.repeat(30000));
  parseLine('ERROR ' + 'msg="'.repeat(10000));
  assert.ok(Date.now() - t < 2000, `took ${Date.now() - t}ms`);
  assert.equal(printable('bad \x1b[31m red \x07'), 'bad ?[31m red ?');
});

test('CLI: file, stdin, gz, json, --fail and errors', () => {
  const log = 'ERROR timeout after 30ms\nERROR timeout after 99ms\nWARN slow\n\x1b]0;pwned\x07ERROR evil\n';
  const p = tmp('app.log', log);
  const out = run([p]);
  assert.equal(out.status, 0);
  assert.match(out.stdout, /4 lines read · 3 error\+ lines in 2 groups/);
  assert.match(out.stdout, /2 {2}error {2}line 1 +line 2 +timeout after <n>ms/);
  assert.doesNotMatch(out.stdout, /\x1b|\x07/);
  assert.equal(run([], log).stdout.includes('in 2 groups'), true);
  assert.match(run([tmp('app.log.gz', gzipSync(log))]).stdout, /in 2 groups/);
  const j = JSON.parse(run([p, '--json', '--level', 'warn']).stdout);
  assert.equal(j.groups.length, 3);
  assert.equal(run([p, '--fail']).status, 1);
  assert.equal(run([tmp('ok.log', 'INFO fine\n'), '--fail']).status, 0);
  const bad = run(['--levl', 'warn']);
  assert.equal(bad.status, 2); assert.match(bad.stderr, /did you mean --level/);
  assert.equal(run([join(tmpdir(), 'nope-loglens.log')]).status, 2);
  assert.equal(run([p, '--level', 'loud']).status, 2);
});
