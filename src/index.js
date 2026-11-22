// LogLens core: parse log lines, normalize messages into signatures, group them.
// Pure functions, no I/O, no network. Signatures mask variable data (ids, IPs, emails, tokens, quoted strings).

export const printable = (s) => String(s).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '?'); // no terminal escapes from logs

const MAX_LINE = 65536; // longer lines are cut so regexes stay fast

const TIME = String.raw`\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?`;
const LEAD_TIME = new RegExp(`^\\[?(${TIME})\\]?\\s*`);
const LEVEL = /\b(fatal|critical|crit|panic|emerg|alert|error|err|severe|warn|warning|info|notice|debug|trace)\b/i;
const LEVEL_MAP = { fatal: 'fatal', critical: 'fatal', crit: 'fatal', panic: 'fatal', emerg: 'fatal', alert: 'fatal', error: 'error', err: 'error', severe: 'error', warn: 'warn', warning: 'warn', info: 'info', notice: 'info', debug: 'debug', trace: 'debug' };
const PINO = { 10: 'debug', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal' };
export const RANK = { debug: 0, info: 1, unknown: 1, warn: 2, error: 3, fatal: 4 };

// Stack frames and traceback lines belong to the entry above them.
const CONTINUATION = /^(?:\s|at\s|Caused by:|\.\.\. \d+ more|Traceback \(most recent call last\):|During handling of)/;
const EXCEPTION = /^([\w$.]*(?:Error|Exception|Warning))(?::|$)/;

const RULES = [
  [new RegExp(TIME, 'g'), '<time>'],
  [/\bhttps?:\/\/[^\s"'<>]+/g, '<url>'],
  [/(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>'], // lookbehind: start only at a word start, keeps it linear
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
  [/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<ip>'],
  [/"[^"\n]{0,500}"/g, '"<str>"'],
  [/(?<!\w)'[^'\n]{1,500}'(?!\w)/g, "'<str>'"],
  [/\b0x[0-9a-f]+\b/gi, '<hex>'],
  [/[A-Za-z0-9_\-+/]{20,}={0,2}/g, (m) => (/\d/.test(m) && /[A-Za-z]/.test(m) ? '<token>' : m)],
  [/\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, '<hex>'], // 8+ hex chars with a digit: ids, hashes (not words like "facade")
  [/(?<![\w<.])\d+(?:\.\d+)?/g, '<n>'],
];

export function normalize(msg) {
  let s = String(msg).slice(0, MAX_LINE);
  for (const [re, to] of RULES) s = s.replace(re, to);
  return s.replace(/\s+/g, ' ').trim();
}

function toIso(t) {
  if (t == null || t === '') return undefined;
  const d = typeof t === 'number' ? new Date(t < 1e12 ? t * 1000 : t) : new Date(String(t).replace(/^(\d{4})\/(\d{2})\/(\d{2})/, '$1-$2-$3').replace(',', '.'));
  return Number.isNaN(d.getTime()) ? String(t) : d.toISOString();
}

function parseJson(line) {
  let o;
  try { o = JSON.parse(line); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const lv = o.level ?? o.lvl ?? o.severity ?? o.levelname ?? o['log.level'];
  const level = typeof lv === 'number' ? PINO[lv] ?? 'unknown' : LEVEL_MAP[String(lv ?? '').toLowerCase()] ?? 'unknown';
  const errMsg = (e) => (e && typeof e === 'object' ? e.message : undefined);
  const message = o.msg ?? o.message ?? errMsg(o.err) ?? errMsg(o.error) ?? (typeof o.error === 'string' ? o.error : '');
  return { level, time: toIso(o.time ?? o.timestamp ?? o.ts ?? o['@timestamp']), message: String(message) };
}

// Returns { level, time?, message } or null for continuation lines (stack frames) and blank lines.
export function parseLine(raw) {
  const line = String(raw).slice(0, MAX_LINE);
  if (!line.trim() || CONTINUATION.test(line)) return null;
  if (line[0] === '{') { const j = parseJson(line); if (j) return j; }
  let rest = line, time;
  const t = LEAD_TIME.exec(rest);
  if (t) { time = toIso(t[1]); rest = rest.slice(t[0].length); }
  const ex = EXCEPTION.exec(rest);
  if (ex) return { level: /Warning$/.test(ex[1]) ? 'warn' : 'error', time, message: rest };
  let level = 'unknown';
  const m = LEVEL.exec(rest);
  if (m) {
    level = LEVEL_MAP[m[1].toLowerCase()];
    // Level near the start ("[ERROR] x", "level=error msg=...") is a prefix to drop; later it's part of the message.
    if (m.index < 40) rest = rest.slice(m.index + m[0].length).replace(/^[\]\)>:|\s-]+/, '');
  }
  const logfmt = /\bmsg="((?:[^"\\]|\\.)*)"/.exec(rest) ?? /\bmsg=(\S+)/.exec(rest);
  if (logfmt) rest = logfmt[1];
  return { level, time, message: rest };
}

// Streaming-friendly grouper: call add() per line, then result().
export function createAnalyzer({ minLevel = 'error', maxGroups = 10000 } = {}) {
  const min = RANK[minLevel] ?? RANK.error;
  const groups = new Map();
  let lines = 0, matched = 0, dropped = 0;
  return {
    add(raw, where = {}) {
      lines++;
      const e = parseLine(raw);
      if (!e || RANK[e.level] < min) return;
      matched++;
      const signature = normalize(e.message) || '(empty message)';
      const key = `${e.level}\u0000${signature}`;
      const at = { ...where, ...(e.time && { time: e.time }) };
      let g = groups.get(key);
      if (!g) {
        // shortcut: past maxGroups new signatures are only counted, raise the cap if real logs hit it.
        if (groups.size >= maxGroups) { dropped++; return; }
        groups.set(key, (g = { level: e.level, signature, count: 0, first: at, last: at }));
      }
      g.count++;
      g.last = at;
    },
    result() {
      const list = [...groups.values()].sort((a, b) => b.count - a.count || RANK[b.level] - RANK[a.level]);
      return { lines, matched, groups: list, dropped };
    },
  };
}

export function analyze(lines, opts) {
  const a = createAnalyzer(opts);
  let n = 0;
  for (const l of lines) a.add(l, { line: ++n });
  return a.result();
}
