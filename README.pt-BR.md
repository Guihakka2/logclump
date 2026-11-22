# logclump

[English](README.md) · Português · [日本語](README.ja.md)

Um log de 2 GB com 80.000 erros normalmente são **6 problemas repetidos**. O logclump agrupa linhas parecidas (mesma mensagem, ids e números diferentes) e mostra quantas vezes cada uma aconteceu e quando apareceu **pela primeira e pela última vez**.

Offline, só leitura, zero dependências. A saída é mascarada, então dá para colar numa issue com segurança.

```bash
npx @guihakka2/logclump app.log
npx @guihakka2/logclump app.log.1.gz app.log --level warn
kubectl logs deploy/api | npx @guihakka2/logclump
```

- **Agrupa por assinatura**: números, UUIDs, IPs, emails, URLs, ids hex, tokens e textos entre aspas viram marcadores (`<n>`, `<email>`…).
- **Primeira e última ocorrência** de cada grupo: ache o erro que começou logo depois do deploy.
- **Formatos**: texto, `[LEVEL]`, nginx, logfmt, JSON lines (pino, bunyan, winston, GCP), exceções Python/Java/JS. Stack traces ficam junto do erro.
- **Arquivos grandes**: lê linha por linha, aceita `.gz` e stdin. ~1 s para 500 mil linhas.
- **CI**: `--fail` sai com código 1 se encontrar algum grupo; `--json` para scripts.

**Com agentes de IA (MCP):** `logclump --mcp` roda o logclump como servidor [MCP](https://modelcontextprotocol.io). Em vez de ler milhares de linhas cruas (lento e cheio de emails, IPs e tokens), o agente recebe o resumo curto e mascarado. Aceita arquivos dentro da pasta do projeto ou o texto do log, e é só leitura.

```bash
claude mcp add logclump -- npx -y @guihakka2/logclump --mcp
```

Opções: `--level` (fatal, error, warn, info, all), `--top N`, `--fail`, `--json`. Segurança: veja [SECURITY.md](SECURITY.md).

**Sem Node.js?** Cada [release](https://github.com/Guihakka2/logclump/releases/latest) tem um programa pronto para Windows, macOS e Linux (x64 e ARM): baixe, descompacte e rode `logclump` no terminal. Gerado pelo GitHub Actions, com `SHA256SUMS.txt` e atestado de procedência. Ainda sem assinatura paga: na primeira vez, o Windows mostra o SmartScreen ("Mais informações" → "Executar assim mesmo") e no macOS rode `xattr -d com.apple.quarantine logclump` uma vez.
