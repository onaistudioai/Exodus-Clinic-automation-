# Módulo Estoque — AIOS.clinic / aios-painel

Controle de materiais/insumos por clínica, **integrado ao atendimento**: a baixa do kit
do procedimento é automática ao finalizar o prontuário, e o custo de material vira relatório
por tipo de atendimento. Diferencial vs. "cadastro + alerta" (commodity): estoque↔atendimento.

## Conceitos

- **Produto** — item de catálogo (luva, anestésico…). Tem `estoque_minimo` (limiar de ruptura).
- **Lote** — saldo por validade/custo. `nível(produto) = SUM(lotes.quantidade)`. Pode ir **negativo** (política C3).
- **Movimentação** — livro-razão **append-only** (`entrada`/`saida`/`ajuste`/`estorno`). `quantidade` é **sinalizada** (+entrada / −saída). Correção = nova linha (estorno/ajuste), nunca UPDATE/DELETE.
- **BOM (kit)** — `procedimento_materiais`: materiais consumidos por `tipo_atendimento`.

**Invariante:** `SUM(movimentacoes.quantidade) por produto == SUM(lotes.quantidade)`.

## Baixa automática (FEFO + C3)

No `registrarAtendimento` (hook do prontuário), ao finalizar uma entrada **NOVA** tipo X:
1. Lê o BOM de X.
2. Para cada item, consome lotes por **FEFO** (vence antes primeiro; `validade ASC NULLS LAST`), com `FOR UPDATE` (sem double-spend).
3. **Política C3 (travada):** nunca aborta o atendimento. Falta material → baixa o que houver e empurra o resto como **saldo negativo** (motivo `divergencia`); produto sem lote → cria lote sentinela `DIVERGENCIA`. O hook ainda envolve a baixa num `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` (C4: nada reverte o atendimento, nem tabela ausente).
4. **Correção NÃO reconsome** (é conserto de texto).
5. **M2 — trava de reconsumo:** se o `agendamento_id` já teve baixa por outra entrada, pula (não consome o kit 2×).
6. Custo total da baixa é somado **em SQL (NUMERIC)** sobre o livro-razão da entrada (M1: sem drift de float).

## Multi-tenant e segurança

- 4 tabelas com **RLS FORCE** + policy `rls_tenant` via GUC `app.clinica_id` (fail-closed: sem GUC → 0 linhas). `clinica_id` nunca vem do cliente.
- App conecta como `app_painel` (NOBYPASSRLS). Livro-razão **sem** grant de UPDATE/DELETE (defesa em profundidade além do trigger).
- Toda query roda dentro de `withTenant`/`withTenantReadOnly`.

## RBAC (novas ações em `src/lib/rbac.ts`)

| Ação | Quem |
|---|---|
| `ver_estoque` | todos os papéis |
| `gerir_estoque` | recepção, admin (entrada, ajuste) |
| `configurar_bom` | admin (kits por procedimento) |

## Telas (`src/app/(painel)/estoque/`)

- `/estoque` — níveis + alertas (ruptura, validade próxima/vencida, saldo negativo).
- `/estoque/[produtoId]` — lotes, histórico, entrada, ajuste de inventário.
- `/estoque/bom` — configurar kits por tipo de atendimento.
- `/estoque/relatorio` — custo de material por procedimento num período.

## Arquivos

| Arquivo | Papel |
|---|---|
| `.planning/estoque/sql/001-estoque.sql` | DDL + RLS + grants + trigger |
| `src/types/domain.ts` | tipos (Produto, Lote, MovimentacaoEstoque, BomItem, NivelProduto, AlertaEstoque, CustoProcedimento, ResultadoBaixa) |
| `src/server/estoque.repo.ts` | DAL (FEFO, C3, M1/M2, custo) |
| `src/app/(painel)/estoque/actions.ts` | server actions + RBAC |
| `src/app/(painel)/prontuario/[pacienteId]/actions.ts` | hook de baixa automática |
| `.planning/estoque/QA-RUNBOOK.md` | QA (seed, contrato, E2E) |

## Operação / deploy

- **Migration:** aplicar `sql/001-estoque.sql` via `sofia-demo/sql/_run-sql.mjs` (não há staging; proxy TCP off). Idempotente.
- **Deploy do painel:** Railway (serviço `aios-painel`). **Requer aprovação** — não automatizado.

## Pendências conhecidas (v1.1)

- **M3** — lote sentinela `DIVERGENCIA` pode duplicar sob concorrência de produto-sem-lote (cosmético; invariante mantida).
- **L4** — eslint do projeto quebrado (eslintrc×flat, circular JSON) — pré-existente, gate real é `next build`.
- **Fase 2 roadmap** — trocar BOM por `tipo_atendimento` por catálogo de `procedimento_id` desacoplado.
