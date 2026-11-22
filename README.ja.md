# loglens

[English](README.md) · [Português](README.pt-BR.md) · 日本語

2 GB のログに 80,000 件のエラーがあっても、実際には **同じ 6 つの問題の繰り返し** であることがほとんどです。loglens は似た行（同じメッセージで ID や数値だけ違うもの）をまとめ、件数と **最初・最後に発生した時刻** を表示します。

オフライン・読み取り専用・依存ゼロ。出力はマスクされるので、そのまま issue に貼れます。

```bash
npx @guihakka2/loglens app.log
npx @guihakka2/loglens app.log.1.gz app.log --level warn
kubectl logs deploy/api | npx @guihakka2/loglens
```

- **シグネチャでグループ化**：数値・UUID・IP・メール・URL・16進 ID・トークン・引用符内の文字列をプレースホルダー（`<n>`、`<email>` など）に置換
- **最初と最後の発生時刻**：デプロイ直後に始まったエラーがすぐ分かる
- **対応形式**：テキスト、`[LEVEL]`、nginx、logfmt、JSON Lines（pino・bunyan・winston・GCP）、Python/Java/JS の例外。スタックトレースは上のエラーにまとめる
- **大きなファイル**：1 行ずつ処理、`.gz` と標準入力に対応。50 万行で約 1 秒
- **CI**：`--fail` でグループが見つかれば終了コード 1、`--json` でスクリプト向け出力

オプション：`--level`（fatal / error / warn / info / all）、`--top N`、`--fail`、`--json`。セキュリティは [SECURITY.md](SECURITY.md) を参照。
