# PLANO_EXECUTIVO — Módulos AGENDA + TURNOS (AIOS.clinic)

> Fase 1 OPUS (ARCHITECTUS). Baseado em `PROJECT_SPEC.md` (D1–D6 + K1–K3 travadas) e nos padrões
> herdados (Estoque/Reativação/Financeiro): DAL `withTenant`/GUC, RLS FORCE + grants, Server Actions
> `useActionState`, migração via `_run-sql.mjs` + verificação ao vivo. Módulo MAIOR que o Financeiro
> (5 entidades + cálculo de disponibilidade + UI timeline) → mais partes, mais tempo.

## Escopo travado da v1

`profissionais` + `servicos` (catálogo c/ duração) + `turnos` (recorrência semanal) + `bloqueios`
(exceções) · Agenda visão **dia/timeline por profissional** (marcar/remarcar/cancelar/confirmar/no-show) ·
**disponibilidade** = turno − bloqueio − agendamento · **anti-overbooking no banco** (exclusion constraint) ·
encaixe explícito · check-in do dia integrado · reuso dos lembretes n8n · indicadores ocupação + no-show.
**Fora da v1:** sala/recurso, filtro por competência, lista de espera, carga horária/custo, visão mês (v2+).

---

## Partes & dependências

| # | Parte | Depende de | Outputs |
|---|-------|-----------|---------|
| P1 | Migração SQL (btree_gist, 4 tabelas, ALTER agendamentos+clinicas, backfill, exclusion constraint, RLS, grants) | — | `sql/001-agenda-turnos.sql` em prod, verificado |
| P2 | Tipos + RBAC (`ver_agenda`, `gerir_agenda`, `gerir_escala`) | — | `types/domain.ts`, `lib/rbac.ts` |
| P3 | DAL `agenda.repo.ts` (CRUD config + disponibilidade `slots_livres` + ops de agendamento + indicadores) | P1, P2 | `src/server/agenda.repo.ts` |
| P4 | Server Actions + disparo de lembrete n8n na criação | P3 | `app/(painel)/agenda/actions.ts` |
| P5a | UI config: profissionais, serviços, turnos (grade semanal), bloqueios | P3, P4 | `app/(painel)/agenda/{profissionais,servicos,turnos}/**` |
| P5b | UI Agenda: timeline dia por profissional + ações + check-in + indicadores | P3, P4 | `app/(painel)/agenda/**` |

---

## Waves

### WAVE 1 (Paralelo | ~35 min) — Fundação
- **P1 — Migração SQL** — Timeout: 35 min
  - **Pre-flight K1:** GET do workflow SOFIA live → confirmar credencial = `postgres` (superuser/bypassrls) antes do FORCE em `agendamentos`.
  - `CREATE EXTENSION btree_gist`; `clinicas += timezone` (default America/Sao_Paulo).
  - Tabelas `profissionais`, `servicos`, `turnos`, `bloqueios` (ver DRAFT-agenda-turnos.sql).
  - `ALTER agendamentos_sofia_demo += profissional_id, servico_id, inicio, fim, overbooking_intencional, profissional_legado`.
  - **Backfill** dos 2 registros (clínica 2): cria `profissionais`/`servicos` a partir dos textos distintos; seta `inicio/fim` de `data+hora AT TIME ZONE timezone` + duração; mapeia `profissional_id`/`servico_id`.
  - **Exclusion constraint** `no_overbooking` (btree_gist) — **só depois do backfill** (senão NULLs/sobreposições barram).
  - RLS FORCE + policy nas 4 novas E em `agendamentos` (K1 ok); grants `app_painel`.
  - Verificar ao vivo (tabelas, constraint, RLS, e que o insert estilo-SOFIA ainda passa como superuser).
- **P2 — Tipos + RBAC** — Timeout: 15 min
  - `domain.ts`: `Profissional`, `Servico`, `Turno`, `Bloqueio`, `SlotLivre`, `AgendamentoDia` (estendido), `IndicadoresAgenda`, `DiaSemana`.
  - `rbac.ts`: `ver_agenda` (todos), `gerir_agenda` (recepção+admin: marcar/remarcar/etc.), `gerir_escala` (admin: profissionais/serviços/turnos/bloqueios).

### WAVE 2 (Sequencial | ~45 min) — Dados + disponibilidade
- **P3 — DAL `agenda.repo.ts`** — Depende de: Wave 1 — Timeout: 45 min
  - Config CRUD: profissionais, serviços, turnos, bloqueios (tenant-scoped, padrão Estoque).
  - **`slotsLivres(profissionalId, dia)`**: gera horários livres = turnos do dia (vigentes) − bloqueios − agendamentos não-cancelados; passo = duração do serviço. Núcleo do módulo (provável função SQL + composição em JS).
  - **Agendamento ops:** `criar` (seta inicio/fim por serviço; a exclusion constraint trava overbooking → traduzir `exclusion_violation` em erro amigável), `remarcar` (ciclo `remarcacao_pendente`), `cancelar`, `confirmarPresenca`, `marcarNoShow`, `agendaDoDia(data)` (por profissional).
  - **Indicadores:** ocupação (agendado/disponível), no-show por profissional/período.
- *(Gate W2→W3: DAL compila TS estrito; `slotsLivres` validado contra um cenário real.)*

### WAVE 3 (Paralelo | ~55 min) — Aplicação
- **P4 — Server Actions + lembrete n8n** — Depende de: Wave 2 — Timeout: 25 min
  - Actions de config (gerir_escala) e de agenda (gerir_agenda), padrão `useActionState`.
  - Na criação de agendamento pelo painel: **disparar o mesmo webhook n8n** de confirmação/lembrete (agnóstico à origem, D4). Reusar o trilho da SOFIA.
- **P5a — UI config** — Depende de: Wave 2 — Timeout: 30 min
  - `/agenda/profissionais`, `/agenda/servicos`, `/agenda/turnos` (**grade semanal** profissional × dias), `/agenda/bloqueios`.
- **P5b — UI Agenda (timeline)** — Depende de: Wave 2 — Timeout: 55 min
  - `/agenda` — **visão dia, colunas = profissionais, linhas = horário**; slot livre clicável → marcar; cards de agendamento c/ ações (confirmar/remarcar/cancelar/no-show); encaixe explícito; **check-in do dia** (chegou/em atendimento/finalizado) integrado; indicadores ocupação+no-show. Nav "Agenda".

## Tempo total estimado: ~3h (3 waves). P5b (timeline) é a parte mais pesada.
## Agentes simultâneos: até 3 na Wave 3 (P4, P5a, P5b)

---

## Gates por fase
- W1→W2: migração aplicada e **verificada ao vivo** (tabelas + exclusion constraint + RLS + insert SOFIA ainda passa).
- W2→W3: DAL compila; `slotsLivres` e a trava de overbooking validados.
- Código → Fase 3 (REVIEWER): build verde, zero `any`, RLS/constraint/timezone conferidos.
- Fase 4 (QA): contract-test SQL (anti-overbooking sob sobreposição, RLS fail-closed, cross-tenant,
  disponibilidade correta, encaixe pula trava) — padrão herdado.

---
*ARCHITECTUS — Fase 1. Próxima: Fase 2 (CONDUCTOR) → Wave 1 após aprovação do plano.*
