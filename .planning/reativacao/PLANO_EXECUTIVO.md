# PLANO_EXECUTIVO — Módulo Reativação

> Fase 1 OPUS (ARCHITECTUS). Deriva do `PROJECT_SPEC.md` (decisões D1–D4 travadas).
> Padrão herdado fielmente do Estoque/PROC-B: RLS FORCE + GUC `app.clinica_id`, DAL repo +
> `withTenant`, livro-razão append-only, worker n8n no padrão M3/M4.

## Mapa de arquivos (alvo)

```
aios-painel/
├── .planning/reativacao/
│   ├── PROJECT_SPEC.md            (Fase 0 ✅)
│   ├── PLANO_EXECUTIVO.md         (este)
│   ├── config.json
│   ├── wave-{1,2,3}-state.json    (Fase 2)
│   └── sql/001-reativacao.sql     (migração + RLS + view detecção)
├── src/types/domain.ts            (+ tipos Reativação)
├── src/lib/rbac.ts                (+ ação gerir_reativacao)
├── src/server/reativacao.repo.ts  (DAL)
├── src/app/(painel)/reativacao/
│   ├── page.tsx                   (público + métricas + campanha)
│   ├── actions.ts                 (server actions c/ RBAC)
│   └── *Componentes*.tsx
└── src/app/(painel)/layout.tsx    (+ link "Reativação" no nav)
sofia-demo/n8n/
└── wf-reativacao.json + _deploy-reativacao.mjs   (worker cron→PG→WAHA, dry-run default)
```

## Tabelas (DDL — detalhe na migração)

- **`reativacao_campanhas`** — cadência por clínica: `id, clinica_id, nome, janela_dias(=30),
  passos jsonb([{offset_dias,template}]), ativa bool, criado_em`. RLS FORCE.
- **`reativacao_alvos`** — paciente em sequência: `id, clinica_id, campanha_id, paciente_id,
  contato_id, passo_atual int, proximo_envio timestamptz, status('ativo'|'reativado'|'optout'|'concluido'),
  entrou_em, reativado_em`. RLS FORCE. UNIQUE parcial (clinica,paciente) WHERE status='ativo' (1 sequência ativa/paciente).
- **`reativacao_envios`** — livro-razão **append-only**: `id, clinica_id, alvo_id, passo, enviado_em,
  modo('dry'|'live'), wa_status, wa_erro`. RLS FORCE + trigger no-DELETE/UPDATE; `app_painel` sem UPDATE/DELETE.
- **`v_reativacao_inativos`** (view `security_invoker`) — pacientes elegíveis conforme §2 do SPEC
  (último `realizada` <= hoje-janela, sem futuro, sem opt-out, contato titular ativo não revogado).

## Waves

### WAVE 1 (Paralelo | ~25 min) — fundações independentes
- **P1 — Migração SQL** (`sql/001-reativacao.sql`): 3 tabelas + RLS FORCE + policy `rls_tenant` +
  grants `app_painel` (sem UPDATE/DELETE em envios) + trigger append-only + view `v_reativacao_inativos`.
  Idempotente. — Timeout: 25 min. Depende de: —
- **P2 — Tipos + RBAC**: `domain.ts` (Campanha, Alvo, Envio, InativoView, EstadoAlvo, ModoEnvio) +
  `rbac.ts` ação `gerir_reativacao` (admin + recepção; `ver_reativacao` p/ todos). — Timeout: 15 min. Depende de: —

### WAVE 2 (Paralelo | ~35 min) — depende da Wave 1
- **P3 — DAL** (`reativacao.repo.ts`): detectar inativos (lê a view), preview de público (count, sem
  efeito), criar/editar/ligar/desligar campanha, materializar alvos (anti-duplicata via UNIQUE parcial,
  valida `paciente_id ∈ clínica` — lição M2), registrar envio (append-only), avançar passo, atribuição
  de retorno (varre agendamentos novos → marca `reativado`), métricas agregadas. `withTenant`.
  Depende de: P1 (schema) + P2 (tipos). — Timeout: 35 min.
- **P4 — Worker n8n** (`wf-reativacao.json` + `_deploy-reativacao.mjs`): cron diário 8–17h →
  `SET app.clinica_id` por clínica → seleciona alvos `proximo_envio<=now` (cap baixo) → **dry-run
  default** (só loga) / **live** atrás de `REATIVACAO_LIVE=1` → WAHA `sendText` → grava `reativacao_envios`
  → avança `passo_atual`/`proximo_envio` ou `concluido`. Anti-duplicata + rate limit. GET-then-PUT idempotente.
  Depende de: P1 (tabelas). — Timeout: 35 min.

### WAVE 3 (Sequencial | ~30 min) — depende da Wave 2
- **P5 — Server actions** (`reativacao/actions.ts`): `requireAcao('gerir_reativacao')`; carregar público,
  criar/ligar/desligar campanha, materializar alvos, rodar atribuição. Depende de: P3. — Timeout: 15 min.
- **P6 — UI** (`reativacao/page.tsx` + componentes + link no nav): tabela de inativos elegíveis, card de
  campanha (cadência, ativa/inativa), métricas (enviados/respondidas/reativados/taxa), badge "dry-run".
  Depende de: P5. — Timeout: 30 min.

## Tempo total estimado: ~90 min (3 waves)
## Agentes simultâneos: até 2 por wave (W1: P1+P2 · W2: P3+P4 · W3: P5→P6 sequencial)

## Gates (OPUS)
- F2→F3: `tsc` + `eslint` + `next build` verdes; migração aplica em prod (contract-test BEGIN..ROLLBACK).
- F3 (REVIEWER): zero HIGH. F4 (QA): contract-test (RLS fail-closed/isolamento, append-only, UNIQUE
  alvo ativo, atribuição, opt-out honrado) + seed Aurora. F5 (FIXER) se necessário. F6 docs.
- Deploy prod (railway up) só com aprovação explícita do user.

## Nota de execução
Por padrão do ambiente, as partes serão executadas **inline** (eu assumindo os papéis), não via
subagentes paralelos — a menos que o user peça explicitamente paralelização com subagentes.

---
*ARCHITECTUS — Fase 1. Próxima: Fase 2 (CONDUCTOR → codificação por waves) após aprovação do plano.*
