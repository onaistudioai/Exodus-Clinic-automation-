# Módulo Financeiro — AIOS.clinic (estado de entrega)

> OPUS, 2026-06-22. v1 entregue: código + build verde + contract-test ao vivo PASSED.
> Schema em produção (Railway PG). **Falta:** deploy do app (`railway up`) + E2E manual.

## O que entrega (v1)

Cobrança automática ao finalizar o atendimento (não-bloqueante), recebíveis, registro
manual de pagamento (idempotente), lançamento manual de caixa, inadimplência, e painel
com os indicadores que o gestor quer ver primeiro. Margem por procedimento fecha o loop
com o Estoque (receita − custo de material). Recibo PDF e export CSV para o contador.

## Arquitetura (padrões herdados de Estoque/Reativação)

| Camada | Arquivo | Nota |
|---|---|---|
| Schema | `.planning/financeiro/sql/001-financeiro.sql` | 3 tabelas, RLS FORCE, append-only, anti-dup |
| Tipos | `src/types/domain.ts` (bloco Financeiro) | — |
| RBAC | `src/lib/rbac.ts` | `ver_financeiro` (todos), `gerir_financeiro` (recepção+admin) |
| DAL | `src/server/financeiro.repo.ts` | `withTenant`/GUC, NUMERIC→float8 |
| Actions | `src/app/(painel)/financeiro/actions.ts` | preço, pagamento, lançamento, cancelar |
| Hook | `src/app/(painel)/prontuario/[pacienteId]/actions.ts` | SAVEPOINT `financeiro_cobranca`, não-bloqueante |
| UI | `src/app/(painel)/financeiro/**` | painel, preços, relatório, recibo, export |

## Tabelas (produção)

- **financeiro_precos** — preço por `tipo_atendimento` (UNIQUE clínica+tipo). Mutável.
- **financeiro_cobrancas** — recebível (mutável: status `aberta`→`paga`/`cancelada`).
  Anti-dup: `uq_cobranca_por_entrada`.
- **financeiro_lancamentos** — livro-razão **append-only** do caixa (trigger + grant sem
  UPDATE/DELETE). Idempotência do pagamento: `uq_lancamento_por_cobranca`.

## Invariantes provadas (contract-test 003 — PASSED ao vivo)

Anti-dup cobrança/entrada · idempotência pagamento · append-only · CHECK valor>0 ·
RLS fail-closed · isolamento entre clínicas · grant sem DELETE · WITH CHECK cross-tenant.

## Decisões (D1–D8, ver PROJECT_SPEC §7)

Registro manual de pagamento (Pix-API/Asaas → v1.1) · preço por tipo + override · D0 default ·
recibo PDF + CSV na v1 (NFS-e/OFX → v2) · LGPD: recibo/cobrança sem dado clínico, só titular.

## Fluxo fim-a-fim

1. Admin cadastra preços em `/financeiro/precos`.
2. Médico finaliza atendimento → hook cria cobrança `aberta` (preço vigente, venc. D0).
   Sem preço cadastrado: não cria, loga `warn`, atendimento finaliza normal.
3. Recepção registra pagamento em `/financeiro` → cobrança `paga` + lançamento `receita`
   (idempotente) → entra no caixa.
4. Recibo: `/financeiro/recibo/{cobrancaId}` (só cobrança paga). Caixa CSV: `/financeiro/export`.
5. Painel mostra caixa do dia/mês, a-receber, inadimplência, faturamento, ticket; relatório
   de margem cruza com o Estoque.

## Pendências

- [ ] **Deploy do app**: `railway up` de `aios-painel/` (schema já está em prod).
- [ ] **E2E manual**: cadastrar preço → finalizar atendimento de teste → pagar → conferir
      recibo + caixa, na clínica Aurora (id 2).
- [ ] v1.1: Pix-API (Asaas), lembrete de inadimplência (worker n8n dry-run), vencimento configurável.
