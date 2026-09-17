# Módulo Agenda + Turnos — AIOS.clinic (estado de entrega)

> OPUS, 2026-06-23. v1 entregue: código + build verde + contract-test ao vivo 5/5 PASSED.
> Schema em produção; turnos semeados na Aurora; deploy via `railway up`.

## O que entrega (v1)

Gestão de agenda no painel com **disponibilidade real** derivada dos **turnos** (escala recorrente),
marcação por **slot de duração do serviço**, **anti-overbooking atômico no banco** (cobre a corrida
SOFIA × balcão), encaixe explícito, ações do dia (confirmar/compareceu/faltou/cancelar/remarcar),
e indicadores (ocupação, no-show). Fonte única com a SOFIA; lembretes n8n reaproveitados.

## Arquitetura (padrões herdados)

| Camada | Arquivo | Nota |
|---|---|---|
| Schema | `sql/001-agenda-turnos.sql` | btree_gist, 4 tabelas, ALTER agendamentos, RLS, exclusion constraint |
| Tipos | `src/types/domain.ts` (bloco Agenda) | Profissional/Servico/Turno/Bloqueio/SlotLivre/AgendamentoDia |
| RBAC | `src/lib/rbac.ts` | `ver_agenda`(todos)/`gerir_agenda`(recep+admin)/`gerir_escala`(admin) |
| DAL | `src/server/agenda.repo.ts` | CRUD + `slotsLivres` + ops + indicadores |
| Actions | `src/app/(painel)/agenda/actions.ts` | config + agendamento + buscarSlots/buscarPacientes |
| UI | `src/app/(painel)/agenda/**` | dia, profissionais, serviços, turnos (grade) |

## Tabelas

- **profissionais** — entidade real (usuario_id nullable).
- **servicos** — catálogo nome → duração (define o tamanho do slot).
- **turnos** — janela recorrente semanal = fonte de disponibilidade.
- **bloqueios** — exceções (férias/folga/feriado; prof null = clínica toda).
- **agendamentos_sofia_demo** (evoluído) — +profissional_id/servico_id/inicio/fim/overbooking_intencional/
  profissional_legado; `chat_id` agora nullable; RLS FORCE; exclusion constraint `no_overbooking`.

## Invariantes provadas (contract-test 002, ao vivo PASSED)

slotsLivres exclui horário ocupado · anti-overbooking barra sobreposição (mesmo prof) ·
encaixe (`overbooking_intencional`) pula a trava · cancelada/no_show libera o horário ·
RLS fail-closed + isolamento entre clínicas.

## Decisões (D1–D6 + K, ver PROJECT_SPEC §3)

Duração por serviço (sala/recurso v2) · profissional = entidade · conflito bloqueado no banco +
encaixe explícito (lista de espera v2) · fonte única + lembretes n8n reaproveitados · turno semanal =
disponibilidade (carga/custo v2; NÃO é ponto legal) · timestamptz + clinicas.timezone · btree_gist.

## Integração com a SOFIA (K1 verificado ao vivo)

Writer da SOFIA = workflow do router via role **`app_n8n` (BYPASSRLS=true)** → ligar RLS
FORCE em `agendamentos` NÃO quebra o agendamento por WhatsApp. Painel (`app_painel`, sem bypass) fica
isolado por tenant. Lembretes D-1/D0 são crons que varrem a mesma tabela → pegam agendamentos do balcão
automaticamente (criarAgendamento popula data_agendamento/hora_agendamento/chat_id).

## Pendências

- [ ] Validação manual na UI (logar no painel → Agenda).
- [ ] v1.1: visão grade-coluna real (timeline), cron de lembrete filtrar `chat_id IS NOT NULL`.
- [ ] v2: sala/recurso, lista de espera, carga horária/custo (gancho Financeiro), filtro por competência.

## Lições da migração (registradas)

(1) o ID do workflow SOFIA no CLAUDE.md estava defasado — sempre listar live. (2) `data_agendamento`
é `date` + `hora_agendamento` `time` (local) → inicio = `(data+hora) AT TIME ZONE tz`. (3) UNIQUE com
`lower()` = índice, não constraint inline. (4) UPDATE...FROM não aceita o alvo no ON de JOIN. (5)
`chat_id` era NOT NULL — quebraria marcação de balcão (pego pelo contract-test).
