# loglens

[English](README.md) · Português · [日本語](README.ja.md)

Um log de 2 GB com 80.000 erros normalmente são **6 problemas repetidos**. O loglens agrupa linhas parecidas (mesma mensagem, ids e números diferentes) e mostra quantas vezes cada uma aconteceu e quando apareceu **pela primeira e pela última vez**.

Offline, só leitura, zero dependências. A saída é mascarada, então dá para colar numa issue com segurança.

```bash
npx @guihakka2/loglens app.log
npx @guihakka2/loglens app.log.1.gz app.log --level warn
kubectl logs deploy/api | npx @guihakka2/loglens
```

- **Agrupa por assinatura**: números, UUIDs, IPs, emails, URLs, ids hex, tokens e textos entre aspas viram marcadores (`<n>`, `<email>`…).
- **Primeira e última ocorrência** de cada grupo: ache o erro que começou logo depois do deploy.
- **Formatos**: texto, `[LEVEL]`, nginx, logfmt, JSON lines (pino, bunyan, winston, GCP), exceções Python/Java/JS. Stack traces ficam junto do erro.
- **Arquivos grandes**: lê linha por linha, aceita `.gz` e stdin. ~1 s para 500 mil linhas.
- **CI**: `--fail` sai com código 1 se encontrar algum grupo; `--json` para scripts.

Opções: `--level` (fatal, error, warn, info, all), `--top N`, `--fail`, `--json`. Segurança: veja [SECURITY.md](SECURITY.md).
