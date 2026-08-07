# QA dedicada — Módulo Prontuário (2026-06-21)

> Mesmo método do estoque: contrato SQL auto-verificável (ROLLBACK, sem lixo) +
> E2E ao vivo. Banco de produção (Bella=2). Runner `sofia-demo/sql/_run-sql.mjs pront-contract`.

## Resultado: ✅ 10/10 no contrato + happy-path E2E ao vivo

### Camada A — contrato do modelo (`pront-contract-test.sql`)
Rodado em produção, **PASSED**. Cobre:
1. **append-only** — `DELETE` em `prontuario_entradas` bloqueado (trigger `t_pront_append_only`).
2. **finalização → agendamento** — virar `finalizado` com `agendamento_id` marca o agendamento `realizada` (trigger `t_pront_finaliza`) e seta `finalizado_em`.
3. **imutabilidade** — alterar texto clínico de entrada `finalizado` é bloqueado.
4. **`chk_finalizado_exige_tags`** — finalizar sem `tipo_atendimento` viola a constraint.
5. **`fn_e_menor`** — <18 anos.
6. **RLS controle positivo** — `app_painel` com GUC=2 vê as entradas da Bella.
7. **RLS fail-closed** — sem GUC, `prontuario_entradas` e `prontuario_acessos` = 0 linhas.
8. **RLS isolamento** — clínica 1 não vê entradas da clínica 2.
9. **grant** — `app_painel` tem INSERT/SELECT/UPDATE, **sem DELETE** (expurgo é UPDATE lógico).
10. **`fn_login_lookup`** (SECURITY DEFINER) acha user ativo sem GUC, enquanto `SELECT` direto em `usuarios` sem GUC é fail-closed.

### Camada B — E2E ao vivo (UI real)
Login médico (Bella) → Prontuário → paciente "mar" (7) → registrar atendimento `procedimento` → **finalizar**. Criou `prontuario_entradas` id=4, disparou a baixa de estoque integrada (provada no E2E do estoque). Caminho feliz confirmado em produção.

## Fora do escopo desta QA (honesto)
- **RBAC (`requireAcao`)** — é camada de aplicação (TS), não banco. Verificado por código (toda server action chama `requireAcao` com a ação certa: `criar_entrada_prontuario`=médico, `ler_texto_clinico`=médico/admin, recepção só etiquetas), **mas não executado** com sessões de papéis diferentes nesta QA.
- **Correção** (`corrige_entrada_id`) e **expurgo LGPD** — fluxos existem e a imutabilidade (teste 3) é o que os força; não exercitados ponta-a-ponta.

## Veredito
Prontuário: garantias de banco **provadas (10/10)** + happy-path **ao vivo**. Pendente só
o que é app-layer/edge (RBAC executado, correção/expurgo E2E) — sem bloqueadores conhecidos.
