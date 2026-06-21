# PLANO_EXECUTIVO — aios-painel (módulo Prontuário/Check-in)

> Waves de execução. Dentro de uma wave as partes são independentes (paralelizáveis);
> cada wave depende da anterior. Execução atual: **inline sequencial** (sem spawn de agentes).

## Estado-base (já em produção)
Scaffold, auth (fn_login_lookup), RBAC, withTenant/RLS, check-in (buscar + criar paciente).

---

## WAVE 0 — Fundação arquitetural (esta entrega) | ~feita agora
Estabelece as camadas onde todo o resto encaixa. **Sem mudar URLs nem regredir o deploy.**
- **0.1** `src/types/domain.ts` — tipos de domínio compartilhados.
- **0.2** `src/server/*.repo.ts` — Data Access Layer (pacientes + esqueletos agendamentos/prontuário).
- **0.3** Refatorar check-in para usar `pacientes.repo` (prova o padrão Action→Repo).
- **0.4** Route group `(painel)/` com layout protegido (verifySession + nav por papel).
- **0.5** `src/components/` — primitivos de UI (Campo, Botão, Card, Badge).
- **Gate:** `tsc` + `next build` verdes; deploy live sem regressão.

## WAVE 1 — Fechar o elo Sofia→balcão | depende de Wave 0
- **1.1** `agendamentos.repo.confirmarIdentidade` + `listarPorPaciente`.
- **1.2** Ação "Confirmar identidade" no check-in (seleciona paciente → escolhe agendamento
  pendente → carimba `paciente_id` + `identidade_confirmada_*`).
- **Gate:** check-in termina num estado real; teste manual com agendamento da Bella.

## WAVE 2 — Prontuário (lado médico) | depende de Wave 1
- **2.1** `prontuario.repo` completo (listar, criarRascunho, finalizar, corrigir, expurgar, registrarAcesso).
- **2.2** `/prontuario/[pacienteId]` — listar entradas + criar/finalizar (gate médico).
- **2.3** `/pacientes/[id]` — ficha (recepção vê etiquetas; médico vê tudo).
- **2.4** Auditoria automática: `registrarAcesso` em toda leitura/escrita clínica.
- **Gate:** médico cria e finaliza entrada; agendamento vira 'realizada' (trigger); recepção NÃO vê texto.

## WAVE 3 — Qualidade (OPUS) | depende de Wave 2
- **3.1** Testes unitários (idade, cpf, rbac, validações) — Vitest.
- **3.2** Testes de integração dos repos contra Postgres (tenant + RLS fail-closed).
- **3.3** CI (GitHub Actions): lint → typecheck → test → build.
- **Gate:** cobertura ≥80% no núcleo de regras; CI verde.

## WAVE 4 — Bordas | depende de Wave 2
- **4.1** `/pacientes/merge` — mesclar duplicatas (dupla confirmação digitando o nome).
- **4.2** Número reciclado → `a_reconfirmar` no check-in.
- **4.3** `/admin/auditoria` — visualizar `prontuario_acessos`.

---

## Tempo estimado (inline): Wave 0 agora · Waves 1–4 sob demanda
## Dependências externas: PROC-A (schema já aplicado) ✅
