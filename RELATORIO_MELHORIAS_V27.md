# Mestre da Loteria – Sorte Certa (v27) — Correções + Melhorias

Este pacote inclui correções de estabilidade, cache e automação para GitHub Pages (pasta **/docs**).

## Correções aplicadas (principais)

1) **Cache-busting nos JSON do histórico e latest (GitHub Pages)**
- Adicionado `CACHE_BUSTER` e `withCB()` para evitar resultado “antigo” por cache/CDN ao buscar:
  - `docs/data/history_<loteria>.json`
  - `docs/api/<loteria>.json`
- Arquivo: `docs/assets/common.js`

2) **normalizeHistoryObj mais robusto**
- Agora aceita:
  - `dezenas` como **array** ou **string** `"1,2,3"`
  - itens com `raw` (útil para modalidades sem dezenas padrão, ex.: loteca/federal)
- Arquivo: `docs/assets/common.js`

3) **fetch mais seguro contra cache**
- `tryFetchJson()` ajustado para `cache: "no-store"`.
- Arquivo: `docs/assets/common.js`

4) **Toast com escape de HTML**
- Evita injeção acidental por strings (título/mensagem).
- Arquivo: `docs/assets/common.js`

5) **Remoção de workflow redundante**
- Mantido o workflow principal da CAIXA (servicebus2) e removido o antigo `update-lottery-history.yml` para evitar conflito/duplicidade.
- Pasta: `.github/workflows/`

6) **Rodapé atualizado**
- Removida dica de “server local por CORS” e substituída por orientação correta (GitHub Actions).
- Arquivos: `docs/*.html`

## Melhorias de UX já existentes no pacote
- Botões de navegação rápida na página **Estatísticas** (âncoras com scroll suave).
- Loader “prime” com figura do Brasil e preenchimento progressivo.

---

## Sugestões de melhorias (próximos upgrades)

### A) Automação e performance
- **Ajustar o cron**: `*/10 * * * *` é bem frequente. Sugestão:
  - a cada 30 min (`*/30 * * * *`) ou
  - a cada 1h (`0 * * * *`)
- **Limitar crescimento do histórico** (opcional):
  - manter últimos X concursos no `history_*.json` para reduzir tamanho e acelerar estatísticas.

### B) Estatísticas (mais “pro”)
- Adicionar seleção de **janela anterior automática** (base N vs N anteriores) com KPI de “mudança %”.
- Exportação CSV/Excel por seção (freq/recência, repetidas, pares/ímpares).

### C) Meus Jogos
- “Conferir” automático: quando entrar o resultado do concurso, atualizar status dos jogos vinculados ao concurso.
- Tags: “Favorito”, “Sistema A/B/C”, “Fixos”, “Paridade”.

### D) Qualidade do código
- Criar `docs/assets/config.js` centralizando:
  - limites por modalidade, endpoints, labels e defaults.
- Criar um `docs/assets/storage.js` para padronizar LocalStorage (favoritos, meus jogos, preferências).
