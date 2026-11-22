# logclump

[![npm](https://img.shields.io/npm/v/@guihakka2/logclump)](https://www.npmjs.com/package/@guihakka2/logclump) [![CI](https://github.com/Guihakka2/logclump/actions/workflows/ci.yml/badge.svg)](https://github.com/Guihakka2/logclump/actions/workflows/ci.yml)

English · [Português](README.pt-BR.md) · [日本語](README.ja.md)

A 2 GB log file with 80,000 errors is usually **6 problems repeated**. logclump groups similar lines (same message, different ids and numbers) and shows how often each happened and when it was **first and last seen**.

Offline, read-only, zero dependencies. Output is masked, so it's safe to paste into an issue.

```bash
npx @guihakka2/logclump app.log
npx @guihakka2/logclump app.log.1.gz app.log --level warn
kubectl logs deploy/api | npx @guihakka2/logclump
docker compose logs --no-color | npx @guihakka2/logclump --top 5
```

```
$ logclump app.log
logclump  500,002 lines read · 71,464 error+ lines in 3 groups

   COUNT  LEVEL  FIRST SEEN           LAST SEEN            MESSAGE
  71,429  error  2026-11-21 10:00:00  2026-11-21 18:19:59  db timeout after <n>ms host=<ip>
      34  error  2026-11-21 15:00:00  2026-11-21 15:00:02  payment <n> failed for <email>
       1  fatal  2026-11-21 18:20:00  2026-11-21 18:20:00  TypeError: Cannot read properties of undefined (reading '<str>')
```

## Features

- **Groups by signature**: numbers, UUIDs, IPs, emails, URLs, hex ids, tokens and quoted strings are masked, so `timeout after 3000ms` and `timeout after 120ms` are one group.
- **First and last seen** per group: spot the error that started right after a deploy.
- **Formats**: plain text, `[LEVEL]` prefixes, nginx error logs, logfmt (`level=error msg="…"`), JSON lines (pino numeric levels, bunyan, winston, GCP `severity`), Python/Java/JS exceptions. Stack frames are folded into the error above them.
- **Big files**: streams line by line, reads `.gz` rotated logs and stdin. ~1 s for 500k lines.
- **CI**: `--fail` exits 1 when any group is found, `--json` for scripts.

## Options

| Option | |
|---|---|
| `--level L` | Minimum level: `fatal`, `error` (default), `warn`, `info`, `all` |
| `--top N` | Show the N biggest groups (default 20, `0` = all) |
| `--fail` | Exit 1 if any group is found |
| `--json` | Machine-readable output |

Lines without a level count as `unknown` and show up with `--level info` or `all`. Lines like `ValueError: …` or `TypeError: …` count as errors.

## Security

See [SECURITY.md](SECURITY.md). Read-only, no network, terminal escape sequences from logs are neutralized, and hostile lines can't make it hang. Masking is best-effort: review output before posting it publicly.

## License

MIT · Part of [Guihakka Tools](https://github.com/Guihakka2/guihakka-tools)
