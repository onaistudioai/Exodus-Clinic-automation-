# PROJECT_SPEC — Módulos AGENDA + TURNOS (AIOS.clinic)

> Fase 0 OPUS (MAGISTER). Decisões D1–D6 + técnico TRAVADAS pela pesquisa (2026-06-22).
> Fundamentado no schema de produção (inspeção ao vivo 2026-06-22): `agendamentos_sofia_demo`
> existe com `profissional`/`servico` TEXTO LIVRE e SEM RLS; `usuarios` sem especialidade/horário;
> `clinicas.horario_func` texto; **só 2 agendamentos** (migração trivial); **btree_gist disponível**
> (não instalado). Profissionais atuais: "Dra. Teste Medico", "Dr. Henrique Lopes". Serviços: "consulta","odonto".

## 1. Objetivo

Trazer a **gestão de agenda** para o painel (marcar/remarcar/cancelar/confirmar/no-show + check-in
do dia), com **disponibilidade real** derivada dos **Turnos** (escala recorrente dos profissionais),
e **anti-overbooking atômico no banco** — porque há dois escritores concorrentes (SOFIA/WhatsApp e
balcão) na mesma tabela. Fonte única de agendamento; reuso dos lembretes n8n.

## 2. Definições de domínio

- **Profissional:** entidade real (`profissionais`), **separada do login** (`usuario_id` nullable).
  Corrige o `profissional` texto-livre que não casa com turno/métrica.
- **Serviço:** catálogo (`servicos`) nome → **duração padrão (min)**. Override por agendamento.
- **Turno:** janela de trabalho **recorrente semanal** (`turnos`: profissional, dia_semana, hora_início/fim,
  vigência). **É a fonte da disponibilidade** da Agenda.
- **Bloqueio:** exceção pontual com data (`bloqueios`: férias/folga/feriado/ausência) que "fura" o turno.
- **Disponibilidade:** `turno do profissional − bloqueios − agendamentos existentes`, dentro do horário da clínica.
- **Agendamento:** mantém-se em `agendamentos_sofia_demo` (fonte única c/ a SOFIA), agora com
  `profissional_id`/`servico_id`/`inicio`/`fim` e trava de sobreposição.

## 3. Decisões TRAVADAS (gate Fase 0 ✅ — pesquisa 2026-06-22)

### AGENDA
- **D1 — Modelo:** ✅ **duração por serviço** (catálogo `servicos`, override no agendamento). Slot fixo NÃO.
  **Sala/recurso → v2** (campo previsto no schema, sem lógica de conflito agora). Visão default: **dia, timeline por profissional**.
- **D2 — `profissionais`:** ✅ **criar entidade na v1**, `usuario_id` nullable (profissional ≠ usuário).
  Especialidade = **campo simples na v1**; filtro por competência ("quem faz canal") → v2.
- **D3 — Conflito:** ✅ **bloquear no banco** (exclusion constraint, ver §6). Encaixe via flag explícita
  `overbooking_intencional`. **Lista de espera → v2.**
- **D4 — Fonte única:** ✅ `agendamentos_sofia_demo` (renomear p/ `agendamentos` quando estabilizar).
  ✅ **reusar os workflows n8n** de confirmação/lembrete, disparados por **evento de criação** (agnóstico à origem).
- **D5 — Indicadores:** ✅ taxa de **ocupação** · taxa de **no-show** (por profissional/período) · horários ociosos ·
  agendamentos por profissional. (ocupação + no-show são os que o dono pede)

### TURNOS
- **D6 — Turno = disponibilidade:** ✅ **recorrente semanal na v1**; sem turno → profissional não aparece disponível.
  Campos mínimos: `profissional_id, dia_semana, hora_inicio, hora_fim, vigencia_inicio, vigencia_fim?`.
  Exceções via `bloqueios` (sobreposição, não edita o turno base). **Carga horária/custo → v2** (coerência c/ Financeiro v2).
  ✅ **NÃO é controle de ponto legal** (sem REP/eSocial) — explícito no produto e na doc. RBAC: editar turno = **admin**.

### TÉCNICO
- **K1 — RLS:** ✅ **RLS FORCE** nas tabelas novas. Em `agendamentos`: ⚠️ **verificar o writer da SOFIA/n8n
  ANTES de ligar FORCE** (policy própria por `clinica_id` OU role `BYPASSRLS`). **Sync point #1 / risco.**
- **K2 — Fuso:** ✅ `timestamptz` (UTC) + **`clinicas.timezone`** (IANA, default `America/Sao_Paulo`); converte na borda.
  [VERIFICAR] se há clínica fora de SP hoje (provável que não → default cobre).
- **K3 — Anti-overbooking:** ✅ **exclusion constraint** com `btree_gist` sobre
  `(profissional_id WITH =, tstzrange(inicio,fim) WITH &&) WHERE status NOT IN ('cancelada','no_show') AND NOT overbooking_intencional`.

## 4. Features por prioridade

### 🔴 Crítico (v1)
1. Tabelas + RLS: `profissionais`, `servicos`, `turnos`, `bloqueios` (FORCE + GUC, padrão herdado).
2. Migração de `agendamentos_sofia_demo`: `+profissional_id, +servico_id, +inicio, +fim, +overbooking_intencional`,
   `clinicas.+timezone`, `+profissional_legado`; backfill dos 2 registros; `btree_gist` + exclusion constraint.
3. DAL + Disponibilidade (calcula slots livres de um profissional num dia a partir de turno−bloqueio−agendamentos).
4. CRUD Profissionais + Serviços (admin).
5. CRUD Turnos (grade semanal por profissional) + Bloqueios (admin).
6. Agenda — **visão dia (timeline por profissional)**: marcar/remarcar/cancelar/confirmar/no-show, com a
   trava de conflito e o encaixe explícito. RBAC: ver (todos), gerir (recepção+admin).
7. Check-in do dia integrado (chegou/em atendimento/finalizado) reusando o módulo de check-in/prontuário.
8. Disparo dos lembretes/confirmação n8n na criação pelo painel (mesmo trilho da SOFIA).

### 🟡 Alto (v1 se couber)
9. Indicadores: ocupação + no-show por profissional/período.
10. Visão semana (toggle).

### 🔵 Nice-to-have (v2+)
11. Sala/recurso + conflito de sala; filtro por competência; lista de espera (fila + notificação);
    carga horária/banco de horas/custo-comissão (gancho Financeiro v2); visão mês.

## 5. Constraints
- **Multi-tenant RLS** em tudo (novas tabelas FORCE; `agendamentos` só após validar o writer da SOFIA — K1).
- **Fonte única** de agendamento (não criar calendário paralelo).
- **Trava de overbooking no BANCO** (não na app) — cobre SOFIA × balcão atomicamente.
- **Não-regressão da SOFIA:** novas colunas nullable; o insert atual do n8n continua válido sem mudança.
- **Fuso correto** (timestamptz + timezone por clínica) — não usar hora local "solta".
- **Não é ponto legal** (Turnos = organização interna).

## 6. Esboço de schema — ver `sql/DRAFT-agenda-turnos.sql`

`profissionais` · `servicos` · `turnos` · `bloqueios` + ALTER em `agendamentos_sofia_demo` e `clinicas`,
`btree_gist`, exclusion constraint `no_overbooking`. RLS FORCE + grants `app_painel` (padrão Estoque/Reativação/Financeiro).

## 7. Riscos / sync points
- **#1 (K1) — Writer da SOFIA + RLS em `agendamentos`:** ✅ **RESOLVIDO 2026-06-22** — a credencial n8n
  "AIOS Postgres v3" = role `postgres` (`rolsuper=true`, `rolbypassrls=true`), logo **bypassa RLS**: ligar
  RLS FORCE em `agendamentos` NÃO quebra o writer. Pre-flight na Fase 2: GET do workflow live p/ confirmar que
  ele usa essa credencial (e não outra) antes de aplicar o FORCE. A trava de overbooking não depende de RLS de qualquer forma.
- **#2 — inicio/fim a partir de data+hora+timezone:** backfill correto dos registros existentes (só 2 hoje).
- **#3 — encaixe vs constraint:** `overbooking_intencional=true` sai do predicado da exclusion (decisão simples).

---
*MAGISTER — Fase 0 ✅. Decisões D1–D6 + K1–K3 travadas. Próxima: Fase 1 (ARCHITECTUS) → PLANO_EXECUTIVO + revisar o DRAFT de schema.*
