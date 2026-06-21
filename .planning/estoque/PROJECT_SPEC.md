# PROJECT_SPEC — Módulo Estoque (AIOS.clinic / aios-painel)

> **Fase 0 — MAGISTER (OPUS).** Spec aprovável antes da Fase 1 (ARCHITECTUS).
> **Data:** 2026-06-21 · **Autor:** OPUS/MAGISTER · **Base de pesquisa:** `D:\projetos\Demo\trasncrição\compass_artifact_...md`

---

## 0. Contexto e decisões travadas

| Decisão | Escolha | Origem |
|---|---|---|
| Onde vive | **No painel** (`aios-painel`, Next 16 / React 19 / Tailwind v4) | usuário |
| Escopo v1 | **Núcleo + baixa automática por procedimento** (sem IA de previsão) | usuário |
| Cliente | **Roadmap/demo — sem cliente esperando** → priorizar arquitetura sólida e extensível | usuário |
| Diferencial-âncora | Integração **estoque↔atendimento** (baixa automática + custo por procedimento) | pesquisa §5/§7 |
| Previsão por agenda (IA) | **Fora do v1** — arquitetura deve deixar o gancho pronto (fase 2) | pesquisa §7 |

**Por que esse escopo:** a pesquisa mostra que "cadastro + alerta de mínimo/validade" é commodity que todo incumbente (iClinic, Feegow, ProDoctor) já tem e ninguém reclama — não é arena de competição. O diferencial defensável é amarrar consumo de insumo ao procedimento atendido (custo por procedimento + base para previsão via agenda). O painel **já tem** esse gancho: `registrarAtendimento` finaliza um atendimento com `tipo_atendimento` dentro de uma transação multi-tenant.

---

## 1. Objetivo

Dar à clínica controle de materiais/produtos com **rastreabilidade de lote e validade** e **baixa automática de insumos a cada atendimento finalizado**, dentro do painel existente, respeitando o multi-tenant (RLS por `clinica_id`), o RBAC e os padrões de DAL/Server Actions já estabelecidos no PROC-B.

Resultado visível em semanas (pesquisa §5): alerta preditivo de vencimento + alerta de ruptura + "quanto cada procedimento custa em material".

---

## 2. Features por prioridade

### 🔴 Crítico (v1 — precisa estar pronto)

1. **Catálogo de produtos** — CRUD de itens (`nome`, `categoria`, `unidade`, `estoque_minimo`, `controlado` bool, `ativo`). RBAC: gestão = recepção/admin.
2. **Lotes com validade** — todo produto pode ter N lotes (`codigo_lote`, `validade`, `quantidade`, `custo_unitario`). Saídas consomem por **FEFO** (First-Expire-First-Out).
3. **Movimentações (livro-razão)** — entrada (compra/ajuste), saída (consumo/perda/ajuste). Append-only auditável; toda saída referencia o(s) lote(s) consumido(s) e o motivo. Nunca editar/deletar movimentação — estorno = nova movimentação inversa.
4. **Nível atual + alertas** — quantidade disponível por produto (soma dos lotes); alerta de **estoque ≤ mínimo** (ruptura) e de **validade próxima/vencida** (FEFO). View/tela de "alertas" como painel inicial do módulo.
5. **Kit de materiais por procedimento (BOM)** — mapa `tipo_atendimento → [produto, quantidade]`. Configurável por clínica.
6. **Baixa automática no atendimento** — quando `registrarAtendimento` finaliza uma entrada, deduzir o kit do `tipo_atendimento` correspondente **na mesma transação** (FEFO), gerando movimentações de saída vinculadas ao `agendamento_id`/`entrada_id`. Falha de estoque insuficiente = decisão de política (ver §5, constraint C3).
7. **Custo por procedimento** — derivado: somatório `quantidade × custo_unitario` dos lotes consumidos por atendimento. Relatório simples (por período / por tipo).

### 🟠 Alto (v1 se couber, senão v1.1)

8. **Histórico de movimentações por produto** — timeline (entradas/saídas/estornos) com usuário e timestamp.
9. **Ajuste de inventário (contagem)** — recontagem manual que gera movimentação de ajuste auditada.
10. **Relatório de perdas** — saídas por motivo "perda/vencimento", % sobre valor de estoque (métrica-chave da pesquisa: perda ~2% do valor, 88% por vencimento).

### 🟢 Nice-to-have (fora do v1 — roadmap)

11. **Previsão de demanda por agenda (IA)** — projeta consumo dos próximos N dias a partir de `agendamentos_sofia_demo` futuros × BOM; sugere ponto de reposição. *(Feature-âncora da pesquisa; fase 2.)*
12. **Sugestão/geração de pedido de compra** a fornecedor.
13. **Detecção de anomalia de consumo** (desvio/furto).
14. **Cadeia de frio / IoT de temperatura** (compliance ANVISA RDC 430/2020 ativa).
15. **Catálogo `procedimentos` próprio** (desacoplar o BOM do enum `tipo_atendimento`, permitindo procedimentos arbitrários por clínica).

---

## 3. Tech stack (herdado do aios-painel — NÃO introduzir novas deps sem necessidade)

| Camada | Tecnologia | Observação |
|---|---|---|
| Framework | Next 16.2.x (App Router, Server Actions) | `proxy.ts` em vez de middleware; `params`/`cookies()` async |
| UI | React 19.2.x + Tailwind v4 | mesmos componentes/estilo das telas existentes |
| DB | Postgres (Railway), role `app_painel` (NOBYPASSRLS) | RLS FORCE + policy `rls_tenant` por `clinica_id` |
| Acesso a dados | DAL `src/server/*.repo.ts` + `withTenant()`/`withTenantReadOnly()` | toda query passa pelo GUC `app.clinica_id` |
| Auth/Sessão | `jose` + `bcryptjs`, `verifySession()` | já existe |
| RBAC | `src/lib/rbac.ts` (`requireAcao`) | **adicionar novas ações** (ver §6) |
| Tipos | `src/types/domain.ts` | adicionar tipos do estoque |
| Testes | (a definir na Fase 4 — alinhar com QA) | Vitest unit + Playwright E2E contra app deployado, padrão PROC-B |

---

## 4. Modelo de dados (proposta — ARCHITECTUS detalha DDL na Fase 1)

Todas as tabelas: `clinica_id INT NOT NULL`, **RLS FORCE + policy `rls_tenant`**, grants `app_painel` (SELECT/INSERT/UPDATE; sem DELETE — append-only onde aplica), `app_n8n` se a fase 2 (n8n) precisar ler.

```
produtos              (id, clinica_id, nome, categoria, unidade, estoque_minimo,
                       controlado, ativo, criado_em)
lotes                 (id, clinica_id, produto_id→produtos, codigo_lote, validade DATE,
                       quantidade NUMERIC, custo_unitario NUMERIC, criado_em)
movimentacoes_estoque (id, clinica_id, produto_id, lote_id→lotes, tipo
                       ['entrada','saida','ajuste','estorno'], motivo, quantidade,
                       agendamento_id NULL, entrada_prontuario_id NULL,
                       usuario_id, criado_em)   -- APPEND-ONLY (trigger bloqueia UPDATE/DELETE)
procedimento_materiais(id, clinica_id, tipo_atendimento, produto_id, quantidade)
                       -- BOM v1 chaveado pelo enum existente; fase 2 → procedimento_id
```

**Nível atual** = `SUM(lotes.quantidade)` por produto (ou view materializada se escala exigir — hoje não). **FEFO** = consumir lotes `ORDER BY validade ASC` até cobrir a quantidade.

---

## 5. Constraints

- **C1 — Multi-tenant inquebrável.** `clinica_id` vem SEMPRE da sessão (`withTenant`), nunca do cliente. Toda tabela com RLS FORCE. Replicar a prova E2E negativa do PROC-B (clínica A não vê B).
- **C2 — Append-only no livro-razão.** `movimentacoes_estoque` não permite UPDATE/DELETE (trigger), igual ao prontuário. Correção = movimentação de estorno/ajuste.
- **C3 — Política de estoque insuficiente na baixa automática.** Decisão a confirmar na Fase 1: o atendimento **NÃO pode falhar** por falta de material (atendimento clínico é soberano). Proposta: baixa o que houver, registra movimentação parcial + **alerta de divergência** (saldo negativo permitido e sinalizado), nunca aborta a transação do prontuário. *(Decisão de produto — flag pro usuário no gate da Fase 1.)*
- **C4 — Não regredir o prontuário.** O hook de baixa entra **depois** de `finalizar()` no mesmo `tx`; se a baixa lançar, não pode reverter o atendimento (ver C3). Toda mudança em `registrarAtendimento` preserva o comportamento atual.
- **C5 — Sem novas dependências pesadas.** Reusar stack. Sem ORM novo, sem libs de UI extras.
- **C6 — DDL ad-hoc só via n8n.** O TCP proxy do Postgres está OFF (rede interna Railway). Migrations rodam pelo runner `sofia-demo/sql/_run-sql.mjs` (webhook n8n) ou no deploy. Dev local não conecta direto ao banco.
- **C7 — LGPD/ANVISA.** Rastreabilidade de lote/validade é requisito (RDC 430/2020). Sem dado pessoal de paciente nas tabelas de estoque (vínculo é via `agendamento_id`/`entrada_id`, não nome/CPF).

---

## 6. RBAC (extensão de `src/lib/rbac.ts`)

| Nova ação | recepcao | medico | admin |
|---|---|---|---|
| `gerir_estoque` (CRUD produto/lote/entrada/ajuste) | ✅ | — | ✅ |
| `ver_estoque` (níveis, alertas, histórico) | ✅ | ✅ | ✅ |
| `configurar_bom` (kit por procedimento) | — | — | ✅ |

Baixa automática roda no contexto do médico que finaliza o atendimento (sem gate próprio — é efeito do `criar_entrada_prontuario`).

---

## 7. Exemplos de input/output

**Entrada de compra**
```
Input:  produto "Luva Nitrílica M", lote "L2026-08", validade 2026-12-31, qtd 200, custo R$0,80
Output: lote criado; movimentação 'entrada' qtd +200; nível "Luva M" = 200; custo médio atualizado
```

**Baixa automática (atendimento)**
```
Input:  médico finaliza atendimento tipo='limpeza' (BOM limpeza = 2× Luva M, 1× Sugador)
Output: 2 movimentações 'saida' (FEFO: consome lote que vence antes), qtd -2 Luva / -1 Sugador,
        vinculadas a agendamento_id + entrada_prontuario_id; custo do procedimento = R$ X,XX
```

**Alerta de validade**
```
Input:  cron/abertura da tela; lote "L2026-08" vence em 25 dias, restam 40 un
Output: card de alerta "Luva M — lote L2026-08 vence em 25 dias (40 un)" + sugestão FEFO
```

**Estoque insuficiente (C3)**
```
Input:  baixa pede 2 Luva M, há 1 em estoque
Output: movimentação parcial/saldo -1 sinalizado; atendimento finaliza normal; alerta de divergência
```

---

## 8. Critério de sucesso (v1)

1. Recepção/admin cadastra produto, dá entrada com lote/validade, vê nível atualizado.
2. Médico finaliza um atendimento → estoque dos materiais do kit baixa automaticamente por FEFO, na mesma transação, sem quebrar o prontuário.
3. Tela de alertas mostra ruptura (≤ mínimo) e validade próxima/vencida.
4. Relatório mostra custo por procedimento de um período.
5. Prova multi-tenant: clínica A não enxerga estoque/movimentações de B (RLS).
6. Tudo validado E2E contra o app deployado (padrão PROC-B), com `tsc`/build verdes.

---

## 9. Fora de escopo v1 (explícito)

Previsão por IA, geração de pedido de compra, detecção de anomalia, IoT/cadeia de frio, catálogo de procedimentos próprio (desacoplado do enum), app mobile dedicado, multi-depósito/transferência entre unidades.

---

## GATE DE SAÍDA (Fase 0 → Fase 1) — ✅ APROVADO 2026-06-21

- [x] Usuário aprova este PROJECT_SPEC.md
- [x] **C3 resolvido:** baixa automática **NUNCA aborta o atendimento**; falta de material → baixa parcial + saldo negativo sinalizado + alerta de divergência
- [x] **BOM v1 chaveado por `tipo_atendimento`** (enum existente). Catálogo de procedimentos próprio → fase 2.

> Após aprovação → **ARCHITECTUS** produz `PLANO_EXECUTIVO.md` (waves) e o DDL detalhado.
