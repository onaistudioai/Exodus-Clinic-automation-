# Relatório de Simulação de Falhas — Estoque + Prontuário (aios-painel)

> **Formato:** mesmo baseline de `sofia-demo/RELATORIO-REVISAO-FALHAS.md` — severidade 🔴/🟠/🟡/🔵, cada item com **O quê / Impacto / Como resolver / Prevenção**.
> **Escopo:** módulos Estoque e Prontuário no painel em produção (hospedagem da época) + Postgres (clínica Aurora=2).
> **Data:** 2026-06-21 · **Método:** injeção de falhas via SQL (BEGIN..ROLLBACK, nada persistido) + probes HTTP no app no ar + análise estática do código.

## 1. Sumário executivo

Os módulos estão **sólidos no núcleo**: RBAC em toda action, RLS FORCE fail-closed, append-only, FEFO serializado por `FOR UPDATE`, política C3 (nunca trava o atendimento) e o gate de auth do painel — **todos passaram** na bateria. **Nenhuma falha CRÍTICA.** O achado mais relevante é **operacional/observabilidade**: a baixa de estoque falha de forma **silenciosa** (catch vazio), espelhando o H1 do fluxo SOFIA. Os demais são de robustez a escala/concorrência e isolamento de defesa-em-profundidade.

| Severidade | Qtd | Itens |
|---|---|---|
| 🔴 CRÍTICO | 0 | — |
| 🟠 ALTO | 1 | A1 (baixa silenciosa, sem log/alerta) |
| 🟡 MÉDIO | 5 | M1 (invariante só-app), M2 (BOM cross-tenant), M3 (sentinela concorrente), M4 (sem statement_timeout), M5 (saldo negativo só na tela) |
| 🔵 BAIXO | 4 | L1 (pool max 10), L2 (eslint quebrado), L3 (resiliência a env ausente), L4 (proxy é check otimista) |

## 2. Bateria executada (evidências)

### Probes SQL (BEGIN..ROLLBACK — nada gravado)
| Probe | Resultado | Veredito |
|---|---|---|
| **P1** invariante `SUM(mov)=SUM(lotes)` é forçada pelo banco? | banco aceitou divergência (mov=7 vs lotes=10) | 🟡 só a app mantém |
| **P2** trava M2 (reconsumo por agendamento) | 2ª baixa do mesmo agendamento seria pulada | ✅ |
| **P3** BOM clínica-2 → produto clínica-1 (FK tenant-scoped?) | inseriu (FK ignora RLS) | 🟡 |
| **P4** CHECK `estoque_minimo >= 0` | bloqueado pelo chk | ✅ |
| **P5** divergência (C3) mantém invariante e não trava | mov=lotes=−3 coerente | ✅ |

### Probes HTTP (painel no ar)
| Rota (sem sessão) | HTTP | Veredito |
|---|---|---|
| /estoque, /estoque/bom, /estoque/relatorio, /prontuario, /, /admin/auditoria | **307 → /login** | ✅ gate de auth |
| /naoexiste | 404 | ✅ |

> Baseline: deploy novo, baixo tráfego. `/login` = 200; rotas protegidas redirecionam sem sessão.

## 3. Onde o fluxo pode TRAVAR / falhar silencioso

1. **Baixa dentro da transação do prontuário** — isolada por `SAVEPOINT` (C4): a falha da baixa **não** reverte o atendimento. Bom para o atendimento; ruim que o erro é **engolido** (A1).
2. **`FOR UPDATE` em produto "quente"** — duas finalizações concorrentes que consomem o mesmo produto **serializam** (evita double-spend ✅), mas podem **atrasar** uma à outra; sem `statement_timeout` (M4), uma contenção longa segura um slot do pool (L1).
3. **Produto sem lote sob concorrência** — a baixa cria um lote sentinela `DIVERGENCIA`; dois atendimentos simultâneos do mesmo produto-sem-lote podem criar **dois** sentinelas (M3, cosmético).

## 4. Vulnerabilidades e falhas (detalhado)

### 🟠 A1 — Baixa de estoque falha de forma SILENCIOSA (sem log/alerta)
- **O quê:** em `prontuario/[pacienteId]/actions.ts`, a baixa roda em `try { … } catch { ROLLBACK TO SAVEPOINT }` com **catch vazio** — nenhum `console.error`, nenhuma marca na entrada, nenhum alerta.
- **Impacto:** se a baixa falhar de forma sistemática (migração não aplicada num ambiente, bug, tabela ausente, lock), o atendimento **finaliza normalmente** (C4, correto) mas o **estoque nunca é decrementado e ninguém é avisado** → drift de saldo e custo/relatório errados, de forma invisível. É o mesmo padrão do **H1** do fluxo SOFIA.
- **Como resolver:** logar o erro com contexto (`entrada_id`, `tipo_atendimento`, mensagem) no catch; e/ou marcar a entrada como "baixa_pendente"/dead-letter para reprocesso; expor contagem de falhas num painel.
- **Prevenção:** proibir `catch {}` vazio em hooks de integração; observabilidade obrigatória no ponto onde dois domínios se cruzam.

### 🟡 M1 — Invariante de reconciliação é mantida só pela aplicação (DB não força)
- **O quê (P1):** inseri uma `saida` sem baixar o lote → `SUM(mov)=7` vs `SUM(lotes)=10`. O banco **aceitou**.
- **Impacto:** qualquer escritor fora do `baixarPorAtendimento` (script, bug futuro, correção manual) pode romper `SUM(mov)=SUM(lotes)` sem o banco perceber.
- **Como resolver:** job/relatório de reconciliação periódico (alerta se `SUM(mov)≠SUM(lotes)` por produto); ou trigger que recalcule o saldo do lote a partir do livro-razão (modelo "saldo derivado").
- **Prevenção:** todo write em estoque passa pela DAL; testes de invariante no CI quando houver banco de teste.

### 🟡 M2 — BOM cross-tenant: FK não é tenant-scoped
- **O quê (P3):** como `app_painel` da clínica 2, consegui inserir `procedimento_materiais` (clínica 2) apontando para um `produto` da clínica 1 — a FK valida existência **ignorando RLS**.
- **Impacto:** baixo hoje — a leitura (`lerBom`) faz `JOIN produtos … clinica_id=GUC`, então o item cross-tenant é **filtrado/inerte** e nenhum dado da outra clínica vaza. Mas o ponteiro cruzado existe (sujeira referencial; um `produto_id` da app vindo adulterado entraria).
- **Como resolver:** validar na DAL que `produto_id` pertence à clínica antes do INSERT do BOM (já há o padrão), ou FK composta `(clinica_id, produto_id)`.
- **Prevenção:** FKs multi-tenant referenciarem a coluna `clinica_id` junto (chave composta).

### 🟡 M3 — Lote sentinela `DIVERGENCIA` pode duplicar sob concorrência
- **O quê:** produto sem nenhum lote, sob baixa, cria um lote sentinela; não há linha para `FOR UPDATE`, então duas baixas simultâneas criam dois sentinelas (do REVIEW).
- **Impacto:** cosmético — o saldo total e a invariante seguem corretos; só "polui" com 2 lotes negativos.
- **Como resolver:** `unique` parcial por (clinica_id, produto_id) para o sentinela, ou job de consolidação.
- **Prevenção:** preferir saldo derivado do livro-razão (elimina o sentinela).

### 🟡 M4 — Sem `statement_timeout` nas queries do painel
- **O quê:** o pool `pg` (`lib/db.ts`) tem `idleTimeoutMillis` mas **não** define `statement_timeout`. Uma query presa (contenção de `FOR UPDATE`, lock) pendura a request indefinidamente.
- **Impacto:** request pendurada segura um slot do pool (max 10, L1) → sob carga, esgota o pool e derruba rotas que tocam o banco. Espelha o **L2** do SOFIA.
- **Como resolver:** `statement_timeout` (ex. 15s) na connection string / `options` do pool; `lock_timeout` curto nos caminhos de baixa.
- **Prevenção:** timeout explícito é padrão em todo pool de produção.

### 🟡 M5 — Saldo negativo / divergência só visível na tela /estoque
- **O quê:** `listarAlertas` sinaliza `saldo_negativo`, mas só quando alguém abre `/estoque`. Não há push.
- **Impacto:** combinado com A1, divergências podem acumular sem ninguém ver.
- **Como resolver:** resumo diário (e-mail/notificação) de alertas de ruptura/validade/saldo negativo.
- **Prevenção:** alertas operacionais empurrados, não só sob demanda.

### 🔵 L1–L4 — robustez/observabilidade
- **L1 Pool `max=10`** sem `statement_timeout` (M4) → risco de exaustão sob carga concorrente. → dimensionar + timeout.
- **L2 eslint do projeto quebrado** (`TypeError: circular structure`, eslintrc×flat) — gate de lint não roda; o gate real é o `next build`. → consertar a config (issue à parte).
- **L3 Resiliência a env ausente** — sem `DATABASE_URL`/`AUTH_SECRET` o app lança; mitigado por pool lazy (só rotas que tocam o banco caem; `/login` renderiza). → healthcheck que valide deps no boot.
- **L4 Proxy é check OTIMISTA** (presença do cookie), não authz — a verificação real (assinatura/expiração + RBAC) está no DAL/`requireAcao`. Cookie forjado passa o proxy e é barrado no DAL (fail-closed). Por design (docs Next 16); registrado para não ser confundido com authz.

## 5. O que PASSOU (controles validados)

✅ RBAC em **todas** as actions (estoque + prontuário) · ✅ RLS FORCE fail-closed + isolamento entre clínicas · ✅ append-only (prontuário e livro-razão) · ✅ FEFO serializado por `FOR UPDATE` (sem double-spend em lotes existentes) · ✅ C3 (divergência mantém invariante, não trava atendimento) · ✅ trava M2 · ✅ `CHECK` estoque_minimo/quantidade · ✅ gate de auth do painel (307→/login) · ✅ 404 em rota inexistente.

## 6. Plano de correção priorizado

| # | Ação | Sev | Esforço | Onde | Status |
|---|---|---|---|---|---|
| 1 | Logar + sinalizar falha de baixa (acabar com o catch vazio) | 🟠 A1 | baixo | `prontuario/[pacienteId]/actions.ts` | ✅ feito (`4e95f7e`, deployado) |
| 2 | `statement_timeout`/`lock_timeout` no pool | 🟡 M4 | baixo | `lib/db.ts` | ✅ feito (`69cbc59`, deployado) |
| 3 | Job/relatório de reconciliação `SUM(mov)=SUM(lotes)` | 🟡 M1 | médio | SQL agendado | ✅ view `v_reconciliacao_estoque` (`004`, em prod) |
| 4 | Validar `produto_id` ∈ clínica no INSERT de BOM (ou FK composta) | 🟡 M2 | baixo | DAL / migração | ✅ feito (`69cbc59`, deployado) |
| 5 | Push diário de alertas (ruptura/validade/saldo negativo) | 🟡 M5 | médio | n8n/cron | ✅ workflow n8n `idD7vjFI3XEFq0z7` ativo (cron 08:00 → WAHA) |
| 6 | Consolidar/uniquificar sentinela de divergência | 🟡 M3 | baixo | DAL / migração | ✅ feito (índice `004` + `ON CONFLICT`, deployado) |
| 7 | Consertar config do eslint | 🔵 L2 | baixo | `eslint.config.mjs` | ✅ feito (`67004d6`, deployado) |
| 8 | Pool `max` dimensionável por env | 🔵 L1 | baixo | `lib/db.ts` | ✅ `DB_POOL_MAX` (default 10) (`67004d6`, deployado) |
| 9 | Healthcheck que valida dependências | 🔵 L3 | baixo | `/api/health` + `railway.json` | ✅ `/api/health` (200 up / 503 down) (`67004d6`/`ae794c5`, deployado) |
| 10 | Proxy otimista (cookie) ≠ authz | 🔵 L4 | — | `proxy.ts` | ⛔ por design (authz no DAL/`requireAcao`) — sem mudança |

> **Status (2026-06-21):** A1, M1, M2, M3, M4, M5 corrigidos e em produção. Migration `004-falhas-fixes.sql` aplicada no PG 18.4; painel redeployado e verificado (`/login`=200, rotas protegidas=307, 404 ok; reconciliação = 0 divergências — estoque Aurora vazio pós-cleanup de QA). **M5**: workflow n8n "SOFIA - Alerta Estoque Diário" (`idD7vjFI3XEFq0z7`) ativo — cron `0 8 * * *` → Postgres (digest cross-tenant por superuser; só clínicas COM alertas, sem spam) → WAHA `sendText` p/ `clinicas.telefone_responsavel`. Trigger manual de teste: `POST /webhook/estoque-alerta-trigger` (exige sessão WAHA WORKING + dados de estoque).
>
> **Status (2026-06-22):** 🔵 **L1, L2, L3 corrigidos e em produção** (commits `67004d6` + `ae794c5`, deployment Railway `86d90025` = SUCCESS). L2: eslint voltou a rodar (FlatCompat→configs flat nativos do `eslint-config-next` 16) — gate **verde**; 3 achados que estavam escondidos foram corrigidos (setState-in-effect no ProntuarioPaciente, param morto em `agendamentos.repo`, `eslint-disable` órfão em `db.ts`). L1: `DB_POOL_MAX`. L3: `/api/health` valida o Postgres e é o healthcheckPath do Railway. **L4 fica por design** (proxy é check otimista; authz real no DAL). Verificado ao vivo pós-deploy: `/api/health`=200 `{status:ok,db:up}`, `/login`=200, `/estoque`=307. **Todas as falhas da simulação resolvidas (só L4 permanece, intencionalmente).**

## 7. Checklist de revisão (estoque + prontuário)

- [ ] **Reconciliação:** `SELECT produto_id, SUM(mov)≠SUM(lotes)` → vazio.
- [ ] **Saldos negativos** em `/estoque` (alerta) revisados.
- [ ] **Falhas de baixa** logadas/contadas (após A1).
- [ ] **RLS:** rodar `pront-contract` e `contract` (estoque) → PASSED.
- [ ] **Auth gate:** rotas protegidas redirecionam sem sessão (307→/login).
- [ ] **Pool/timeout:** `statement_timeout` setado; sem requests penduradas.
- [ ] **Sem `catch {}` vazio** novo em hooks de integração.

---
*Simulação executada via `_run-sql.mjs failure-sim` (ROLLBACK) + curl no painel. Nada foi persistido em produção.*
