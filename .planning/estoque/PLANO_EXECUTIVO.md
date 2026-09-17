# PLANO_EXECUTIVO — Módulo Estoque (aios-painel)

> **Fase 1 — ARCHITECTUS (OPUS).** Aprovável antes da Fase 2 (CONDUCTOR/codificação).
> **Data:** 2026-06-21 · Base: `PROJECT_SPEC.md` (aprovado) · Stack herdada do aios-painel.

---

## Estratégia de execução

Módulo dentro de app existente → as "partes" são camadas que se empilham (dados → DAL → actions → UI), com a integração no prontuário como ponto sensível. Waves agrupam o que é **independente entre si**. Execução pelo modelo OPUS, mas **inline (sem spawn de subagentes)** — o orquestrador (eu) roda cada parte e atualiza `wave-N-state.json`. Branch de trabalho: `feat/estoque` (não commitar em `main`/`master` sem pedido).

Cada parte escreve testes básicos junto (regra OPUS Fase 2). Migrations rodam via `sofia-demo/sql/_run-sql.mjs` (TCP proxy OFF — constraint C6).

---

## Waves

### WAVE 1 — Fundações independentes (Paralelo | ~25 min)
> Nada aqui depende de nada. São a base que as waves seguintes consomem.

- **Parte 1 — DDL/Migration** (`.planning/estoque/sql/001-estoque.sql`) — Timeout: 20 min
  - Tabelas `produtos`, `lotes`, `movimentacoes_estoque`, `procedimento_materiais`.
  - RLS FORCE + policy `rls_tenant` (clinica_id via GUC) em todas.
  - Trigger append-only em `movimentacoes_estoque` (bloqueia UPDATE/DELETE).
  - Grants `app_painel` (SELECT/INSERT/UPDATE; sem DELETE).
  - Índices: `lotes(produto_id, validade)` (FEFO), `movimentacoes(produto_id, criado_em)`, `produtos(clinica_id) WHERE ativo`.
  - Seed mínimo de teste (clínica Aurora=2) para E2E posterior.
- **Parte 2 — Tipos + RBAC** — Timeout: 10 min
  - `src/types/domain.ts`: `Produto`, `Lote`, `MovimentacaoEstoque`, `TipoMovimentacao`, `BomItem`, `AlertaEstoque`, `NivelProduto`.
  - `src/lib/rbac.ts`: ações `gerir_estoque`, `ver_estoque`, `configurar_bom` na matriz.

**Gate W1:** SQL aplicado no banco (via runner) com RLS provada (sem GUC → 0 linhas); `tsc` verde com os tipos novos.

---

### WAVE 2 — Camada de dados (Paralelo | ~30 min)
> Depende da Wave 1 (tabelas + tipos).

- **Parte 3 — DAL núcleo** (`src/server/estoque.repo.ts`) — Depende de: W1 — Timeout: 25 min
  - `listarProdutos`, `criarProduto`, `darEntrada` (cria lote + movimentação), `nivelPorProduto` (SUM lotes), `listarAlertas` (ruptura + validade), `historicoProduto`, `ajustarInventario`.
- **Parte 4 — DAL baixa/BOM** (mesmo arquivo, funções separadas) — Depende de: W1 — Timeout: 25 min
  - `lerBom(tipoAtendimento)`, `definirBom`, `baixarPorAtendimento(tx, {tipoAtendimento, agendamentoId, entradaId, usuarioId})` com **FEFO** + **política C3** (baixa parcial, saldo negativo sinalizado, nunca lança a ponto de abortar), `custoPorProcedimento`.

**Gate W2:** funções testadas como `app_n8n`/`app_painel` no banco (FEFO correto; baixa parcial não lança); `tsc` verde.

---

### WAVE 3 — Orquestração / Server Actions (Paralelo | ~30 min)
> Depende da Wave 2 (DAL).

- **Parte 5 — Actions de estoque** (`src/app/(painel)/estoque/*actions.ts`) — Depende de: W2 — Timeout: 25 min
  - CRUD produto, entrada de lote, ajuste, configurar BOM. Cada uma: `requireAcao` + `withTenant` + `revalidatePath`.
- **Parte 6 — Hook de baixa no prontuário** (editar `src/app/(painel)/prontuario/[pacienteId]/actions.ts`) — Depende de: W2 — Timeout: 15 min
  - Após `finalizar()`, dentro do **mesmo `tx`**, chamar `estoque.baixarPorAtendimento(...)`. C4: não regride o prontuário; C3: try/catch defensivo que registra divergência mas não reverte o atendimento.

**Gate W3:** baixa automática dispara em atendimento real (smoke); CRUD via action persiste; `tsc` verde.

---

### WAVE 4 — UI (Paralelo | ~40 min)
> Depende da Wave 3 (actions).

- **Parte 7 — Telas de estoque** (`src/app/(painel)/estoque/`) — Depende de: W3 — Timeout: 35 min
  - `page.tsx` = dashboard de **alertas** (ruptura + validade) como landing do módulo.
  - Lista de produtos + nível atual; form de entrada (lote/validade/custo); histórico por produto; relatório de custo por procedimento. Link no nav (`layout.tsx`), gated por `ver_estoque`.
- **Parte 8 — Config de BOM** (`src/app/(painel)/estoque/bom/`) — Depende de: W3 — Timeout: 20 min
  - Tela admin (`configurar_bom`) para montar kit por `tipo_atendimento`.

**Gate W4:** telas renderizam, RBAC esconde o que deve; build (`next build`) verde.

---

## Fases pós-código (OPUS 3–9)

| Fase | Papel | Saída | Gate |
|---|---|---|---|
| 3 | REVIEWER | `REVIEW_REPORT.md` | zero HIGH |
| 4 | QA | `TEST_REPORT.md` | unit FEFO/baixa + E2E multi-tenant; cobertura ≥80% |
| 5 | FIXER | atualiza reports | zero HIGH, cobertura ≥90% |
| 6 | SCRIPTOR | `docs/` do módulo | docs coerentes |
| 7 | AEDIFICATOR | build | (app já tem deploy Railway; validar build) |
| 8 | DEPLOYATOR | `DEPLOY_REPORT.md` | smoke no app deployado; **prod requer aprovação** |
| 9 | VIGIL | `MONITORING_SETUP.md` | health/erros |

---

## Tempo total estimado: ~2h05 de codificação (W1–W4) + fases de qualidade
## Agentes simultâneos: execução inline pelo orquestrador (sem spawn), waves como ordem lógica
## Branch: `feat/estoque`

---

## Riscos / pontos de atenção

1. **C6 (DDL via n8n):** aplicar `001-estoque.sql` exige o runner; validar que `app_painel` enxerga as tabelas com RLS antes de seguir pra W2.
2. **C4 (não regredir prontuário):** a Parte 6 mexe em arquivo crítico já validado E2E. Snapshot/diff mínimo, preservar fluxo atual, baixa é aditiva.
3. **Saldo negativo (C3):** decisão consciente — `lotes.quantidade`/nível pode ir negativo e isso é sinalizado, não impedido. Garantir que a UI mostra isso como alerta, não como erro.
4. **Next 16:** `params`/`cookies()` async, `proxy.ts`, `next build` não roda lint — seguir os gotchas já documentados no PROC-B.

---

## GATE DE SAÍDA (Fase 1 → Fase 2)

- [ ] Usuário aprova este PLANO_EXECUTIVO.md
- [ ] Confirmar branch `feat/estoque` (vs trabalhar no branch atual)
