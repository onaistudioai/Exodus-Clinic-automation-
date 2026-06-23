# PLANO_EXECUTIVO — Módulo Financeiro (AIOS.clinic)

> Fase 1 OPUS (ARCHITECTUS). Baseado em `PROJECT_SPEC.md` (D1–D8 travadas) e nos padrões
> herdados dos módulos **Estoque** e **Reativação** (DAL `withTenant`/GUC, livro-razão
> append-only via trigger, hook não-bloqueante com SAVEPOINT, RBAC matrix, Server Actions
> com `useActionState`). Wave-shape idêntico ao da Reativação (3 waves), já validado em prod.

## Escopo travado da v1

Tabela de preços · cobrança automática não-bloqueante na finalização · registro manual de
pagamento (idempotente) · lançamento manual receita/despesa · painel (caixa/a-receber/aging/
inadimplência/ticket/faturamento) · margem por procedimento (gancho Estoque) · cancelar
cobrança · recibo PDF/HTML · export CSV. **Fora da v1:** Pix-API/Asaas (v1.1), NFS-e/OFX/
cartão/boleto/parcelamento/convênio/comissão (v2).

---

## Partes & dependências

| # | Parte | Depende de | Outputs |
|---|-------|-----------|---------|
| P1 | Migração SQL (3 tabelas + RLS FORCE + GUC + triggers append-only + grants + índices anti-dup) | — | `sofia-demo/sql/financeiro-schema.sql` em prod, verificado |
| P2 | Tipos de domínio + RBAC (`ver_financeiro`, `gerir_financeiro`) | — | `types/domain.ts`, `lib/rbac.ts` |
| P3 | DAL `financeiro.repo.ts` (preços, cobranças, lançamentos, caixa, aging, margem) | P1, P2 | `src/server/financeiro.repo.ts` |
| P4 | Server Actions + hook de cobrança no prontuário (não-bloqueante) | P3 | `app/(painel)/financeiro/actions.ts`, edição em `prontuario/[pacienteId]/actions.ts` |
| P5 | UI `/financeiro` (painel, recebíveis, lançamento, recibo, CSV) + nav | P3, P4 | `app/(painel)/financeiro/**`, recibo route |

---

## Waves

### WAVE 1 (Paralelo | ~25 min) — Fundação
- **P1 — Migração SQL** — Timeout: 25 min
  - `financeiro_precos(clinica_id, tipo_atendimento, valor NUMERIC(12,2), ativo)` — UNIQUE (clinica_id, tipo_atendimento).
  - `financeiro_cobrancas(id, clinica_id, paciente_id, entrada_prontuario_id, agendamento_id, tipo_atendimento, valor NUMERIC(12,2), vencimento DATE, status, motivo_cancelamento, criado_em, atualizado_em)` — **mutável**. UNIQUE parcial `(clinica_id, entrada_prontuario_id) WHERE entrada_prontuario_id IS NOT NULL` (anti-duplicata da cobrança automática).
  - `financeiro_lancamentos(id, clinica_id, tipo receita|despesa, categoria, valor NUMERIC(12,2), descricao, cobranca_id, forma_pagamento, usuario_id, criado_em)` — **append-only** (trigger `BEFORE UPDATE/DELETE RAISE`). UNIQUE parcial `(clinica_id, cobranca_id) WHERE cobranca_id IS NOT NULL` (idempotência do pagamento: 1 lançamento receita por cobrança).
  - RLS **FORCE** em todas + policies USING/WITH CHECK `clinica_id = current_setting('app.clinica_id')::int`.
  - GRANTs a `app_painel`: SELECT/INSERT/UPDATE em precos+cobrancas; **SELECT/INSERT só** em lancamentos (sem UPDATE/DELETE — reforço do append-only no nível de privilégio, igual `movimentacoes_estoque`).
  - Validação tenant-scoped no INSERT de cobrança (paciente ∈ clínica — lição M2 do Estoque).
  - Deploy via `sofia-demo/sql/_run-sql.mjs`; **verificar ao vivo** (lição: produção primeiro).
- **P2 — Tipos + RBAC** — Timeout: 15 min
  - `types/domain.ts`: `PrecoProcedimento`, `Cobranca` (+`StatusCobranca`), `Lancamento` (+`TipoLancamento`, `FormaPagamento`, `CategoriaDespesa`), `ResumoCaixa`, `LinhaAging`, `MargemProcedimento`.
  - `lib/rbac.ts`: ações `ver_financeiro` (recepcao, medico, admin) e `gerir_financeiro` (recepcao, admin) na MATRIZ + tipo `Acao`.

### WAVE 2 (Sequencial | ~35 min) — Dados
- **P3 — DAL `financeiro.repo.ts`** — Depende de: Wave 1 — Timeout: 35 min
  - Preços: `listarPrecos`, `definirPreco` (upsert), `precoVigente(tipo)`.
  - Cobranças: `criarCobrancaAutomatica` (anti-dup por entrada, preço vigente, não lança se sem preço — loga), `listarCobrancas(status?, periodo?)`, `listarInadimplentes` (aberta + venc<hoje), `cancelarCobranca(motivo)`, `obterCobranca` (p/ recibo).
  - Lançamentos: `registrarPagamento` (idempotente via UNIQUE parcial: marca cobrança `paga` + INSERT lançamento receita), `lancamentoManual(receita|despesa)`.
  - Relatórios: `resumoCaixa(desde, ate)` (SUM receitas−despesas do livro-razão), `aging` (faixas 0-30/31-60/61-90/90+), `ticketMedio`, `faturamentoMes`, `margemPorProcedimento` (JOIN com `custoPorProcedimento` do Estoque), `lancamentosPeriodo` (p/ CSV).
  - **NUMERIC lido como `::float8`** (pg devolve NUMERIC como string), igual Estoque.

### WAVE 3 (Paralelo | ~40 min) — Aplicação
- **P4 — Server Actions + hook de cobrança** — Depende de: Wave 2 — Timeout: 30 min
  - `financeiro/actions.ts`: `definirPrecoAction` (gerir), `registrarPagamentoAction` (gerir), `lancamentoManualAction` (gerir), `cancelarCobrancaAction` (gerir). Validação + `requireAcao` + `withTenant`, padrão idêntico ao `estoque/actions.ts`.
  - **Edição** em `prontuario/[pacienteId]/actions.ts`: dentro do mesmo `withTenant`, **após a baixa de estoque**, novo bloco `SAVEPOINT financeiro_cobranca` → `criarCobrancaAutomatica` → `ROLLBACK TO SAVEPOINT` no catch (NUNCA reverte o atendimento, política C3/C4). Só em entrada NOVA (não em correção).
- **P5 — UI `/financeiro`** — Depende de: Wave 2 — Timeout: 40 min
  - `financeiro/page.tsx` (RSC): cards (caixa do dia/mês, a receber, inadimplência R$+%, ticket, faturamento) + tabelas (recebíveis com aging, inadimplentes, últimos lançamentos). RBAC `ver_financeiro`.
  - `GerenciarFinanceiro.tsx` (client): forms de pagamento, lançamento manual, cancelar cobrança (gated `gerir_financeiro` via prop).
  - `financeiro/precos/page.tsx` — tabela de preços (admin/recepção).
  - `financeiro/relatorio/page.tsx` — margem por procedimento.
  - `financeiro/recibo/[cobrancaId]/route.ts` — recibo HTML imprimível (PDF via print). Conteúdo mínimo legal, sem dado clínico (D8).
  - Export CSV: action/route que serializa `lancamentosPeriodo`.
  - Nav: adicionar "Financeiro" ao menu do painel.

## Tempo total estimado: ~100 min (3 waves)
## Agentes simultâneos: até 2 por wave (módulo pequeno, dependências sequenciais fortes)

---

## Gates por fase (lembrete do ciclo OPUS)
- W1→W2: migração aplicada e **verificada ao vivo** (tabelas+RLS+grants+triggers existem).
- W2→W3: DAL compila (TS estrito) e queries batem com o schema real.
- Código → Fase 3 (REVIEWER): build verde, zero `any`, RLS/idempotência/append-only conferidos.
- Fase 4 (QA): contract-test SQL (anti-dup cobrança, idempotência pagamento, append-only bloqueado,
  cross-tenant negado, hook não-bloqueante) — padrão `pront-contract-test.sql` do Estoque.

---
*ARCHITECTUS — Fase 1. Próxima: Fase 2 (CONDUCTOR) → executar Wave 1.*
