#!/usr/bin/env node
import { createReadStream, statSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createAnalyzer, printable } from '../src/index.js';

const HELP = `Usage: logclump [<file> ...] [options]
       some-command | logclump

Groups similar log lines (same message, different ids/numbers) and shows how often
each happened and when it was first and last seen. Reads plain text, JSON lines
(pino, bunyan, winston…), logfmt and .gz files. Offline, read-only.
Messages are masked: numbers, ids, IPs, emails, URLs, tokens and quoted strings
are replaced with placeholders like <n> or "<str>".

Options:
  --level L     Minimum level: fatal, error (default), warn, info, all
  --top N       Show the N biggest groups (default 20, 0 = all)
  --fail        Exit 1 if any group is found (for CI)
  --json        Machine-readable output
  --mcp         Run as an MCP server (stdio) so AI agents can summarize logs,
                read-only, files limited to the current folder
  -h, --help    Show help
  -v, --version Show version

Exit codes: 0 = done, 1 = --fail and groups found, 2 = usage or read error`;

const OPTIONS = { mcp: { type: 'boolean' }, level: { type: 'string' }, top: { type: 'string' }, fail: { type: 'boolean' }, json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } };
const LEVELS = { fatal: 'fatal', error: 'error', warn: 'warn', info: 'info', all: 'debug' };

const die = (msg) => { process.stderr.write(`logclump: ${printable(msg)}\n`); process.exit(2); };

let args;
try {
  args = parseArgs({ allowPositionals: true, options: OPTIONS });
} catch (e) {
  const bad = /'(--?[\w-]+)'/.exec(e.message)?.[1];
  const near = bad && Object.keys(OPTIONS).find((k) => bad.length > 3 && `--${k}`.startsWith(bad.slice(0, 4)));
  die(`${bad ? `unknown option ${bad}` : e.message}${near ? ` (did you mean --${near}?)` : ''}. See --help.`);
}
const { values: o, positionals: files } = args;
if (o.help) { console.log(HELP); process.exit(0); }
if (o.version) { console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version); process.exit(0); }
if (o.mcp) {
  const { serveMcp, runCli, insideCwd } = await import('../src/mcp.js');
  const self = fileURLToPath(import.meta.url);
  await serveMcp({
    name: 'logclump',
    version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version,
    instructions: 'logclump turns a big log into a short list of distinct problems, with counts and first/last seen times. Prefer it over reading raw logs: output is shorter and masks emails, IPs, ids and tokens.',
    tools: [{
      name: 'logclump_summarize',
      title: 'Summarize errors in logs',
      description: 'Group similar log lines (same message, different ids or numbers) and return each group with its count, level and first/last seen time. Pass log files inside the project folder, or paste log text (e.g. output of kubectl logs or docker compose logs). Numbers, ids, IPs, emails, URLs, tokens and quoted strings are masked in the result. Read-only.',
      inputSchema: {
        type: 'object',
        properties: {
          files: { type: 'array', maxItems: 50, items: { type: 'string' }, description: 'Log files inside the project folder (.log, .gz, JSON lines, logfmt…).' },
          text: { type: 'string', maxLength: 5000000, description: 'Log text to analyze instead of files.' },
          level: { type: 'string', enum: ['fatal', 'error', 'warn', 'info', 'all'], description: 'Minimum level (default error).' },
          top: { type: 'integer', minimum: 0, maximum: 1000, description: 'Number of groups to return (default 20, 0 = all).' },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      validate: (a) => {
        if (!a.files?.length && a.text === undefined) return 'pass "files" or "text"';
        if (a.files?.length && a.text !== undefined) return 'pass either "files" or "text", not both';
        for (const f of a.files ?? []) { if (f.startsWith('-')) return `invalid path "${f}"`; if (!insideCwd(f)) return `"${f}" is outside the project folder`; }
        return null;
      },
      run: (a) => runCli(self, [...(a.files ?? []), '--json', ...(a.level ? ['--level', a.level] : []), ...(a.top !== undefined ? ['--top', String(a.top)] : [])], { input: a.text, okCodes: [0] }),
    }],
  });
  process.exit(0);
}
const minLevel = LEVELS[(o.level ?? 'error').toLowerCase()];
if (!minLevel) die(`unknown level "${o.level}" (use fatal, error, warn, info or all)`);
const top = o.top === undefined ? 20 : Number(o.top);
if (!Number.isInteger(top) || top < 0) die('--top needs a whole number (0 = all)');

const inputs = files.length ? files : ['-'];
if (!files.length && process.stdin.isTTY) { console.log(HELP); process.exit(2); }

const analyzer = createAnalyzer({ minLevel });
for (const f of inputs) {
  let stream;
  if (f === '-') stream = process.stdin;
  else {
    let st;
    try { st = statSync(f); } catch { die(`cannot read ${f}`); }
    if (st.isDirectory()) die(`${f} is a folder, pass log files`);
    stream = createReadStream(f);
    if (/\.gz$/i.test(f)) stream = stream.pipe(createGunzip());
  }
  const name = printable(f === '-' ? 'stdin' : f);
  let n = 0;
  try {
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) analyzer.add(line, { file: name, line: ++n });
  } catch (e) { die(`cannot read ${f}: ${e.code ?? e.message}`); }
}
const r = analyzer.result();
const shown = top ? r.groups.slice(0, top) : r.groups;

if (o.json) {
  console.log(JSON.stringify({ lines: r.lines, matched: r.matched, groups: shown, totalGroups: r.groups.length, dropped: r.dropped }, null, 2));
} else {
  const color = (process.stdout.isTTY || !!process.env.FORCE_COLOR) && !process.env.NO_COLOR;
  const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const LV = { fatal: '35;1', error: '31', warn: '33', info: '36', debug: '2', unknown: '2' };
  const fmt = (n) => n.toLocaleString('en-US');
  const when = (a) => (a.time ? a.time.replace('T', ' ').replace(/\.\d+Z$|Z$/, '') : `${inputs.length > 1 ? `${a.file}:` : 'line '}${a.line}`);
  const label = minLevel === 'debug' ? 'lines' : `${minLevel}+ lines`;
  console.log(`${c(1, 'logclump')}  ${fmt(r.lines)} lines read · ${fmt(r.matched)} ${label} in ${c(1, fmt(r.groups.length))} group${r.groups.length === 1 ? '' : 's'}\n`);
  if (!shown.length) console.log(c(32, '  ✓ nothing found at this level'));
  else {
    const cw = Math.max(5, ...shown.map((g) => fmt(g.count).length));
    const tw = Math.max(10, ...shown.flatMap((g) => [when(g.first).length, when(g.last).length]));
    console.log(c(2, `  ${'COUNT'.padStart(cw)}  LEVEL  ${'FIRST SEEN'.padEnd(tw)}  ${'LAST SEEN'.padEnd(tw)}  MESSAGE`));
    const room = process.stdout.isTTY ? Math.max(30, (process.stdout.columns || 120) - cw - tw * 2 - 15) : Infinity;
    for (const g of shown) {
      const msg = g.signature.length > room ? `${g.signature.slice(0, room - 1)}…` : g.signature;
      console.log(`  ${c(1, fmt(g.count).padStart(cw))}  ${c(LV[g.level], g.level.padEnd(5))}  ${when(g.first).padEnd(tw)}  ${when(g.last).padEnd(tw)}  ${printable(msg)}`);
    }
    if (shown.length < r.groups.length) console.log(c(2, `\n  … ${r.groups.length - shown.length} more groups (use --top 0 to see all)`));
  }
  if (r.dropped) console.log(c(33, `\n  ! ${fmt(r.dropped)} lines skipped: more than 10,000 different messages`));
}
process.exit(o.fail && r.groups.length ? 1 : 0);
