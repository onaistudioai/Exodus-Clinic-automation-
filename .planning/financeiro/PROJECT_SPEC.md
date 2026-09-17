# PROJECT_SPEC — Módulo Financeiro (AIOS.clinic)

> Fase 0 OPUS (MAGISTER). Escopo: **Financeiro**. Fundamentado no schema de produção
> (inspeção ao vivo 2026-06-22): NÃO existe tabela financeira; `clinicas` não tem preços;
> `prontuario_entradas` tem `tipo_atendimento`/`finalizado_em`/`paciente_id`/`agendamento_id`;
> Estoque já calcula custo por procedimento (`movimentacoes_estoque`).

## 1. Objetivo

Controlar **recebíveis, pagamentos, inadimplência e caixa** da clínica, com a cobrança
nascendo automaticamente do atendimento (loop fechado com Prontuário + Estoque).

Diferencial (não vender planilha-commodity): **margem por procedimento** =
receita (preço do atendimento) − custo de material (já vem do Estoque) — número que
clínica nenhuma tem fácil. Cobrança automática + inadimplência rastreada + caixa real.

## 2. Definições de domínio

- **Preço:** valor por `tipo_atendimento` por clínica (tabela `financeiro_precos`,
  mesmo padrão do BOM `procedimento_materiais`). Editável; override manual por cobrança.
- **Cobrança (recebível):** dívida do paciente por um atendimento. Nasce na **finalização**
  do prontuário (hook), com `valor` do preço vigente, `vencimento` e `status`
  (`aberta`|`paga`|`cancelada`). Mutável (status muda).
- **Lançamento (caixa):** livro-razão **append-only** de movimento de caixa
  (`receita`|`despesa`). Pagar uma cobrança gera um lançamento `receita` e marca a
  cobrança `paga`. Despesa/receita avulsa = lançamento manual.
- **Inadimplência:** cobrança `status='aberta'` com `vencimento < hoje`.
- **Caixa (período):** SUM(receitas) − SUM(despesas) dos lançamentos no período.
- **Margem por procedimento:** receita das cobranças × tipo − custo de material (Estoque)
  × tipo. Junta `financeiro_cobrancas` com o custo já computado em `movimentacoes_estoque`.

## 3. Features por prioridade

### 🔴 Crítico (v1)
1. **Tabela de preços** por `tipo_atendimento` (CRUD, admin).
2. **Tabelas + RLS** (FORCE + GUC, padrão herdado): `financeiro_precos`,
   `financeiro_cobrancas` (mutável), `financeiro_lancamentos` (append-only).
3. **Cobrança automática na finalização do atendimento** — hook em `registrarAtendimento`
   (mesmo ponto da baixa de Estoque), **política não-bloqueante (C3-like)**: falha de
   cobrança nunca aborta o atendimento; loga e segue. Anti-duplicata por `entrada_prontuario_id`.
4. **Registrar pagamento** (action) — marca cobrança `paga` + insere lançamento `receita`.
   Idempotente (não paga 2×).
5. **Lançamento manual** (receita/despesa avulsa) — caixa não fica só atado a cobranças.
6. **Painel /financeiro** — caixa do período, contas a receber, **inadimplência** (vencidas),
   com RBAC (`ver_financeiro` todos; `gerir_financeiro` recepção+admin) e RLS.

### 🟡 Alto (v1 se couber)
7. **Relatório de margem por procedimento** (receita − custo Estoque).
8. **Filtro por período** (mês corrente, etc.) no caixa e nos recebíveis.
9. **Cancelar cobrança** (com motivo) — não apaga (append-only no caixa), muda status.
10. **Recibo simples (PDF/HTML)** por cobrança paga — conteúdo mínimo legal (E2 da pesquisa):
    clínica (nome+CNPJ), paciente (nome), data, descrição genérica do serviço, valor, forma de
    pagamento. **Sem citar diagnóstico/procedimento clínico detalhado** (LGPD).
11. **Export CSV** do caixa (lançamentos do período) p/ o contador (G3 da pesquisa).

### 🔵 Nice-to-have (v1.1 / futuro)
12. **Pix-API via Asaas** (cobrança → QR/copia-e-cola → webhook HMAC idempotente). Decisão da
    pesquisa: registro manual é o **piso** da v1; Pix-API só entra se couber ~1 sprint, senão **v1.1**.
    **Travado: fora da v1** (sem credenciais/sandbox configurado; não bloquear a entrega).
13. Lembrete de inadimplência via WhatsApp (worker n8n dry-run, reusando o padrão da Reativação;
    texto LGPD-safe do D3 da pesquisa: só titular, valor+vencimento+link, sem dado clínico).
14. NFS-e via agregador (PlugNotas/NFE.io), OFX, cartão/boleto, parcelamento, convênio (TISS),
    comissão por profissional, multa/juros por atraso. **Tudo v2+.**

## 4. Tech stack (herdado — não reinventar)

- Next 16 (`aios-painel`), Server Actions, RSC, TS estrito.
- Postgres Railway (PG 18.4), **RLS FORCE** + GUC `app.clinica_id`, role `app_painel`
  (sem UPDATE/DELETE no livro-razão `financeiro_lancamentos`).
- DAL `src/server/financeiro.repo.ts` + `withTenant`. RBAC em `lib/rbac.ts`.
- Hook de cobrança no `prontuario/[pacienteId]/actions.ts` (junto da baixa de Estoque).
- Migração via runner `sofia-demo/sql/_run-sql.mjs`. Deploy `railway up` de `aios-painel/`.

## 5. Constraints

- **Dinheiro = precisão:** `NUMERIC(12,2)`; nunca float. Caixa derivado SOMENTE do livro-razão.
- **Append-only no caixa:** lançamento nunca é editado/apagado (correção = estorno). Trigger + grant.
- **Não-bloqueante:** o hook de cobrança nunca derruba a finalização do atendimento (SAVEPOINT, igual Estoque C3).
- **Multi-tenant:** tudo sob RLS; INSERT que referencia paciente/entrada valida `∈ clínica` (lição M2 Estoque).
- **LGPD/sensibilidade:** valores são dado sensível de negócio; RBAC estrito, sem exposição cross-tenant.
- **Idempotência:** cobrança 1×/entrada; pagamento 1×/cobrança.
- **Sem gateway real na v1** (sem credenciais/risco); pagamento é registro manual.

## 6. Exemplos input/output

- **Finalizar atendimento** `procedimento` (preço R$200) → cobrança `aberta` R$200, venc. hoje+0.
- **Registrar pagamento** da cobrança → cobrança `paga` + lançamento `receita` R$200; caixa += 200.
- **Inadimplência:** cobrança `aberta` com venc. < hoje → aparece na lista de vencidas.
- **Margem:** procedimento receita R$200 − custo material R$65 (Estoque) = **margem R$135**.

## 7. Decisões TRAVADAS (gate Fase 0 ✅ — 2026-06-22, pesquisa D3/D4 concluída)

- **D1 — Escopo v1:** ✅ recebíveis + inadimplência + caixa **com lançamento manual** (receita/despesa avulsa).
- **D2 — Cobrança automática no atendimento:** ✅ hook **não-bloqueante** (SAVEPOINT, igual baixa de Estoque).
- **D3 — Pagamento:** ✅ **registro manual** ("marcar pago" + forma: Pix/cartão/dinheiro). Gateway/Pix-API
  via **Asaas** → **v1.1** (API-key + webhook HMAC, sem mTLS; piso é manual — nunca cortar). Cartão/boleto v2.
- **D4 — Preço:** ✅ **tabela por `tipo_atendimento` + override manual** por cobrança. Convênio/comissão → v2.
- **D5 — Vencimento:** ✅ default **D0 (à vista, no ato)**, configurável (D0/D+7/D+30). Parcelamento → v2.
- **D6 — Fiscal:** ✅ **recibo simples (PDF/HTML)** na v1; NFS-e (agregador) e OFX → v2. **Export CSV** na v1.
- **D7 — Painel (top indicadores):** ✅ Caixa do dia · A receber (aberto + aging) · Faturamento do mês ·
  Ticket médio · Inadimplência (% e R$). Bônus: **margem por procedimento** (gancho Estoque).
- **D8 — LGPD na cobrança/mensagem:** ✅ só ao **titular**; pode citar nome da clínica, valor, vencimento,
  link/Pix, canal. **Nunca** procedimento/diagnóstico/profissional; sem tom vexatório (CDC Art. 42).
- **Moeda:** `NUMERIC(12,2)` BRL; nunca float. Caixa derivado SOMENTE do livro-razão append-only.

---
*MAGISTER — Fase 0 ✅ CONCLUÍDA. Decisões D1–D8 travadas. Próxima: Fase 1 (ARCHITECTUS) → PLANO_EXECUTIVO.md.*
