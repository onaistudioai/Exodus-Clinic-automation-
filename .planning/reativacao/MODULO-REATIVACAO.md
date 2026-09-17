# Módulo Reativação — AIOS.clinic / aios-painel

> Entregue pelo ciclo OPUS (2026-06-22). Branch `feat/reativacao`. Em produção:
> migração aplicada, contract-test PASSED, painel deployado, worker n8n em dry-run inativo.

## O que é

Recupera pacientes inativos com uma **sequência automática de mensagens no WhatsApp**,
disparada por inatividade, com cadência configurável, respeito a consentimento e
**atribuição de retorno** (mede quem voltou a agendar após receber a sequência).

Diferencial: fecha o loop no AIOS — usa os agendamentos reais (`agendamentos_sofia_demo`)
para detectar inatividade **e** para medir conversão. Não é disparador de massa cego.

## Decisões (travadas, ver config.json)

- **Janela:** inativo = sem retorno há ≥ 30 dias. **Cadência:** 3 toques D+0 / D+7 / D+21.
- **Opt-out (v1):** honra `paciente_contato.revogado_em`. Captura de "PARAR/SAIR" no router
  SOFIA fica para v1.1.
- **Envio (v1):** **dry-run por padrão** (registra envio simulado, avança o passo, sem WhatsApp).
  Envio real só com o worker deployado com `--live` (cap 50/execução).
- **Superfície:** painel (`/reativacao`) + worker n8n.

## Arquitetura

```
Painel /reativacao (RBAC ver/gerir_reativacao, RLS)
  └─ DAL reativacao.repo.ts (withTenant) ── Postgres (RLS FORCE)
        reativacao_campanhas | reativacao_alvos | reativacao_envios (append-only) | v_reativacao_inativos
Worker n8n "SOFIA - Reativação Diária" (cron 09h, DRY, INATIVO)
  └─ seleciona alvos vencidos → [dry: registra simulado | live: WAHA sendText] → avança passo
```

### Tabelas
- **reativacao_campanhas** — cadência por clínica (`janela_dias`, `passos` jsonb). 1 ativa/clínica (uq parcial).
- **reativacao_alvos** — paciente na sequência (`passo_atual`, `proximo_envio`, `status`). 1 ativa/paciente (uq parcial).
- **reativacao_envios** — livro-razão append-only (`modo` dry|live). Idempotência live por (alvo,passo) (uq parcial).
- **v_reativacao_inativos** — view `security_invoker`: elegíveis (último `realizada`, sem futuro em aberto,
  contato titular não-revogado, sem sequência ativa/opt-out). O filtro de janela é por-campanha (aplicado no caller).

## Fluxo de uso (painel)

1. **Criar campanha** (gerir_reativacao) → cadência default, inativa.
2. **Ativar** a campanha.
3. **Incluir inativos na sequência** (materializar) → entram como alvos (passo 0, proximo_envio = D+0).
4. O **worker** (cron 09h) processa os vencidos: dry-run registra simulado e avança; live envia via WAHA.
5. **Rodar atribuição** → marca `reativado` quem criou agendamento novo após entrar na sequência (janela 30d).
6. **Métricas** no topo: elegíveis, em sequência, reativados, taxa.

## Operação

- **Aplicar migração:** `node sofia-demo/sql/_run-sql.mjs aios-painel/.planning/reativacao/sql/001-reativacao.sql`
- **Contract-test:** `node sofia-demo/sql/_run-sql.mjs aios-painel/.planning/reativacao/sql/003-contract-test.sql` (BEGIN..ROLLBACK)
- **Deploy painel:** a partir da raiz de `aios-painel/` — nunca apontando o path do subdiretório.
- **Deploy worker (dry/inativo):** `node sofia-demo/n8n/_deploy-reativacao.mjs`
  - `--activate` liga o cron · `--live` envia de verdade (cap 50). Trigger manual: `POST /webhook/reativacao-trigger`.
- **Ligar envio real (quando aprovado):** `node sofia-demo/n8n/_deploy-reativacao.mjs --live --activate`.

## QA (contract-test 003 — PASSED em prod)

append-only (UPDATE/DELETE proibidos) · idempotência live por (alvo,passo) · 1 sequência ativa/paciente ·
1 campanha ativa/clínica · RLS fail-closed (sem GUC = 0 linhas) · isolamento entre clínicas ·
app_painel sem DELETE no livro-razão.

## Pendências / v1.1

- Envio **live** ainda não exercitado (dry-run default; sem alvos reais ainda).
- Opt-out via router SOFIA (palavra-chave "PARAR/SAIR").
- Janela de silêncio (fim de semana/feriado), segmentação, A/B de template, digest de ROI ao gestor.
- Identificadores do worker n8n e a URL do painel ficam no cofre local, fora do repositório.
