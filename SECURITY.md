# Security Policy

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting:
**Security tab > Report a vulnerability** on this repository.
You will get a reply within 7 days.

## Design guarantees

- Read-only: logclump never writes, moves or deletes files. No network access, zero runtime dependencies.
- Output shows masked signatures, not raw lines: numbers, ids, IPs, emails, URLs, long tokens and quoted strings become placeholders (`<n>`, `<email>`, `"<str>"`…).
- Terminal control characters from log lines and file names are replaced before printing, so a log cannot inject escape sequences into your terminal.
- Lines are cut at 64 KB and every pattern is linear, so hostile logs cannot make it hang.
- npm releases are built by GitHub Actions with provenance; never by hand.

Masking is best-effort: a secret written as plain words (no digits, no quotes) can still appear. Review output before sharing it publicly.

## MCP mode

`--mcp` (for AI agents) is read-only: files must be inside the folder the server was started in, paths starting with `-` are refused, the CLI runs without a shell, and results are masked exactly like the text output.

## Standalone executables

Release executables are built only by GitHub Actions (`binaries.yml`) from the tagged source with the official Node.js single executable application feature, smoke-tested, and published with a SHA256SUMS.txt and a build provenance attestation (`gh attestation verify <file> -R Guihakka2/logclump`). They are not code-signed with a paid certificate yet.
