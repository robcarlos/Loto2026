# Atualização automática (CAIXA Servicebus2) — GitHub Pages

Este projeto é **estático** (GitHub Pages). Para manter resultados sempre atuais, usamos **GitHub Actions**
para baixar o resultado mais recente de cada loteria e manter um histórico incremental no repositório.

## Saídas geradas pelo workflow
- `docs/api/<loteria>.json` → último resultado (latest)
- `docs/api/latest.json` → bundle com todas as loterias e timestamp
- `docs/data/history_<loteria>.json` → histórico incremental (append só quando o concurso muda)

## Loterias incluídas
megasena, lotofacil, quina, lotomania, timemania, duplasena, federal, loteca, diasorte, supersete, maismilionaria

## Importante no GitHub
Settings → Actions → General → Workflow permissions → **Read and write permissions**.
