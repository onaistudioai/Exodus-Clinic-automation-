# Brief de Pesquisa — Módulos AGENDA + TURNOS (AIOS.clinic)

> Preencher com pesquisa (IA/web/conversa com clínicas). Contexto: SaaS para **clínicas BR de
> pequeno porte** (odonto/estética/saúde). Stack: Next 16 + Postgres (Railway), multi-tenant RLS.
> Já existem: Atendimento (SOFIA/WhatsApp), Prontuário, Estoque, Reativação, Financeiro. Agora vêm
> **Agenda** (gestão de horários no painel) e **Turnos** (escala de profissionais). Responder
> objetivo; citar fonte quando der. Marcar cada item como [FATO] / [RECOMENDAÇÃO] / [VERIFICAR].

---

## ⚠️ O que JÁ EXISTE em produção (não reinventar; a pesquisa decide como evoluir)

- **`agendamentos_sofia_demo`** (a SOFIA já cria/agenda por aqui): `data_agendamento`, `hora_agendamento`,
  `status` (pendente/confirmada/cancelada/remarcacao_pendente/realizada/no_show), `servico` **(texto livre)**,
  `profissional` **(texto livre — NÃO ligado a `usuarios`)**, `paciente_id`, `para_terceiro`,
  flags de confirmação/lembrete (D-1/D0). **Esta tabela NÃO tem RLS** (filtro por `clinica_id` é explícito).
- **`usuarios`**: `id, clinica_id, nome, papel (recepcao|medico|admin), email, ativo`. **Sem** especialidade,
  **sem** horário de trabalho, **sem** entidade "profissional" separada do login.
- **`clinicas.horario_func`**: **texto livre** (ex.: "Seg-Sex 8h-18h") — não há horário estruturado/slots.
- Lembretes D-1 e D0 já saem por workflows n8n; confirmação (módulo 3) já roda.

**Gaps que a pesquisa precisa endereçar:** (1) profissional como entidade real vs texto; (2) modelo de
disponibilidade/slot; (3) catálogo de serviço + duração; (4) como Turnos alimenta a disponibilidade da Agenda.

---

# MÓDULO AGENDA (gestão de horários no painel)

## BLOCO A — Modelo de agenda / slots
A1. Clínica pequena marca por **slot fixo** (ex.: de 30 em 30 min) ou por **duração variável do serviço**
    (limpeza 30min, canal 1h30)? O que é mais comum e o que esperam de um sistema?
A2. **Duração por tipo de serviço**: vale ter um catálogo (serviço → duração padrão) para o sistema
    calcular o fim do horário e evitar overbooking? (hoje `servico` é texto livre)
A3. **Um profissional por agendamento** (cadeira/sala) é a regra, ou há atendimento em paralelo
    (vários profissionais, várias salas)? Precisa modelar **sala/recurso** além de profissional na v1?
A4. **Encaixe/overbooking** intencional (a clínica sabe que cabe mais um) — precisa permitir, ou bloquear conflito sempre?
A5. Visão que o recepcionista quer: **dia (timeline por profissional)**, semana, ou lista? Qual primeiro?
    > Resposta esperada: slot fixo vs duração; modelar sala/recurso na v1 ou v2; visão default.

## BLOCO B — Profissional como entidade
B1. O `profissional` do agendamento deve virar **entidade real** (tabela `profissionais` com
    especialidade, ligada ou não ao `usuarios`/login)? Nem todo profissional tem login no painel —
    como modelar (profissional ≠ usuário)?
B2. **Especialidade/serviços que cada profissional faz** importa para a agenda (filtrar quem pode
    fazer canal)? Precisa na v1?
B3. Migração: os agendamentos atuais têm `profissional` em texto — como casar com a nova entidade
    (mapeamento manual? por nome?).
    > Resposta esperada: criar entidade `profissionais` v1 (sim/não) + relação com `usuarios` + se especialidade entra na v1.

## BLOCO C — Disponibilidade / conflito
C1. Como o sistema sabe que um horário está **livre**? (deriva do horário de funcionamento + turnos do
    profissional − agendamentos existentes). Confirmar a fórmula esperada.
C2. **Bloqueios** (almoço, feriado, férias, ausência pontual) — a clínica precisa marcar? Onde (na Agenda ou nos Turnos)?
C3. **Prevenção de conflito**: o sistema deve impedir 2 agendamentos no mesmo profissional/horário
    (constraint dura) ou só **alertar**? (a SOFIA agenda por WhatsApp em paralelo ao balcão — risco de corrida)
C4. **Lista de espera**: como funciona na prática? (paciente quer um horário lotado → entra na fila →
    quando vaga abre, quem é chamado e como? automático ou manual?)
    > Resposta esperada: regra de disponibilidade + conflito (bloquear vs alertar) + se lista de espera entra na v1.

## BLOCO D — Operação do dia a dia
D1. Ações que o recepcionista mais faz: **marcar, remarcar, cancelar, confirmar presença, registrar no-show**.
    Prioridade/atalhos? (já existe status no_show/realizada)
D2. **Remarcação**: cria novo + cancela o antigo, ou edita? Mantém histórico? (há `remarcacao_pendente`)
D3. **Check-in do dia**: a Agenda deve mostrar "chegou/em atendimento/finalizado" e integrar com o
    check-in/prontuário que já existem?
D4. **No-show**: além de marcar, a clínica quer métrica de taxa de no-show por profissional/período?
    > Resposta esperada: fluxo de remarcação + integração com check-in existente + métricas desejadas.

## BLOCO E — Integração com SOFIA (WhatsApp) e lembretes
E1. A SOFIA hoje agenda direto em `agendamentos_sofia_demo`. A Agenda do painel deve ler/escrever
    **a mesma tabela** (fonte única) — confirmar. Algum motivo p/ separar?
E2. Quando a recepção marca no painel, deve **disparar a mesma confirmação/lembrete** (n8n) que a SOFIA dispara?
E3. **Conflito SOFIA × balcão**: os dois marcam ao mesmo tempo — a trava de conflito (C3) cobre ambos?
    > Resposta esperada: fonte única de agendamento (sim/não) + reuso dos lembretes + cobertura da trava.

## BLOCO F — Expectativa do gestor / relatórios
F1. Indicadores que o dono quer da agenda: **taxa de ocupação** (% de slots preenchidos), no-show,
    horários ociosos, agendamentos por profissional. Top 3-4?
F2. Período padrão e granularidade (dia/semana/mês; por profissional).
    > Resposta esperada: top indicadores da agenda.

---

# MÓDULO TURNOS (escala de profissionais)

## BLOCO G — O que é "turno" na clínica pequena
G1. Clínica pequena realmente usa **escala formal** de turnos, ou o profissional "trabalha quando atende"?
    Qual o tamanho de clínica em que isso passa a importar?
G2. Modelo: **turno recorrente** (ex.: Dra. Ana seg/qua/sex 8-12h) é o caso dominante, ou é tudo ad-hoc?
    Precisa de recorrência semanal na v1?
G3. **Relação Turnos → Agenda**: o turno define a **disponibilidade** do profissional (a Agenda só
    oferece horário dentro do turno)? Essa é a integração-chave — confirmar.
    > Resposta esperada: turno recorrente vs ad-hoc + se turno é a fonte de disponibilidade da Agenda.

## BLOCO H — Conteúdo do turno
H1. Um turno tem: profissional, dia/horário (início-fim), e... sala/recurso? serviço permitido? Quais campos mínimos?
H2. **Exceções**: férias, folga, troca de plantão, ausência pontual — como a clínica registra? (sobrepõe o turno recorrente)
H3. **Carga horária / banco de horas / custo do profissional** — a clínica quer controlar isso, ou é só
    "quem está disponível quando"? (gancho possível com o Financeiro: custo/comissão por profissional — que ficou pra v2 lá)
    > Resposta esperada: campos mínimos do turno + como modelar exceções + se carga horária/custo entra na v1.

## BLOCO I — Operação
I1. Quem mantém a escala (admin? recepção?) e com que frequência muda?
I2. Visão esperada: **grade semanal** (profissional × dias) é o formato? Outra?
I3. **Conflito de turno** (mesmo profissional em dois lugares) — precisa travar?
    > Resposta esperada: quem edita (RBAC) + formato da grade + travas necessárias.

## BLOCO J — Legal/trabalhista (BR) — só o que afeta o modelo
J1. Há exigência trabalhista que o módulo deveria espelhar (registro de ponto, jornada)? Ou é só
    organização interna, **sem** pretensão de ser controle de ponto legal? (provável: só organização)
J2. Profissional **PJ/autônomo vs CLT** muda o que o sistema precisa? (provável: não para a v1)
    > Resposta esperada: o módulo é organização interna (sim/não) + o que explicitamente NÃO faz (ponto legal).

---

## BLOCO K — Técnico / integração (vale p/ os dois)
K1. **RLS**: `agendamentos_sofia_demo` hoje NÃO tem RLS. Ao trazer a Agenda pro painel (role `app_painel`),
    vale **adicionar RLS FORCE** nessa tabela (como nos outros módulos) ou manter filtro explícito? (impacto na SOFIA/n8n que escreve nela)
K2. **Fuso/horário**: agendamentos guardam data+hora local da clínica — confirmar convenção (sem timezone vs America/Sao_Paulo).
K3. **Concorrência**: trava de conflito de horário (exclusion constraint `tstzrange` / unique por slot) — qual
    abordagem o Postgres oferece de mais robusto p/ impedir overbooking sob corrida (SOFIA + balcão)?
    > Resposta esperada: RLS na tabela de agendamentos (sim/não) + convenção de fuso + mecanismo anti-overbooking.

---

## Resumo que eu preciso de volta (mínimo para destravar a Fase 0/1)

**AGENDA**
1. Slot fixo vs duração por serviço; modelar **sala/recurso** na v1 ou v2.
2. Criar entidade **`profissionais`** (separada de `usuarios`)? Especialidade na v1?
3. Conflito de horário: **bloquear** (constraint) vs alertar. **Lista de espera** na v1 ou v2?
4. **Fonte única** = `agendamentos_sofia_demo` (reusar com a SOFIA)? Reusar os lembretes n8n?
5. Top 3-4 **indicadores** da agenda (ocupação, no-show…).

**TURNOS**
6. Turno **recorrente** (semanal) é a fonte da **disponibilidade** da Agenda? (integração-chave)
7. Campos mínimos do turno + como modelar **exceções** (férias/folga).
8. **Carga horária/custo** entra na v1 ou v2 (gancho com Financeiro)?
9. Confirmar que é **organização interna** (NÃO controle de ponto legal).

**TÉCNICO**
10. Adicionar **RLS FORCE** em `agendamentos_sofia_demo`? Mecanismo **anti-overbooking** (exclusion constraint)?

(O resto refina o design; estes 10 destravam o PLANO_EXECUTIVO.)

---

## Decisões que vão ser TRAVADAS na Fase 0 (quando você voltar com a pesquisa)
- **D1** Escopo Agenda v1 (marcar/remarcar/cancelar/confirmar/no-show + visão dia) vs incluir lista de espera/recurso.
- **D2** Entidade `profissionais` (sim/não) e relação com `usuarios`.
- **D3** Disponibilidade derivada de Turnos (sim) + anti-overbooking (bloquear vs alertar).
- **D4** Fonte única `agendamentos_sofia_demo` + RLS nessa tabela (sim/não).
- **D5** Escopo Turnos v1 (recorrência semanal + exceções) e se carga horária/custo entra.
- **D6** Reuso dos lembretes/confirmação n8n quando a recepção marca no painel.

*(Mesmo fluxo do Financeiro: você pesquisa → travamos D1–D6 → ARCHITECTUS faz o PLANO_EXECUTIVO em waves.)*
