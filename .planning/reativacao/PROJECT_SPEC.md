# PROJECT_SPEC — Módulo Reativação (AIOS.clinic)

> Fase 0 OPUS (MAGISTER). Escopo travado pelo user: **Reativação**.
> Fundamentado no schema de produção (inspeção ao vivo 2026-06-22) e no padrão dos
> senders SOFIA (M3 Confirmação e M4 Lembrete D-0:
> cron → Postgres → WAHA `sendText`).

## 1. Objetivo

Recuperar pacientes inativos ("que sumiram") com **sequências automáticas de mensagens
no WhatsApp**, disparadas por inatividade, com cadência configurável, respeito a
consentimento/opt-out, e medição de retorno (paciente reativado = volta a agendar).

Diferencial (mesma régua do Estoque — não vender commodity): **reativação fechada no
loop do AIOS** — usa os agendamentos reais (`agendamentos_sofia_demo`) para detectar
inatividade e para *medir* a conversão (quem recebeu a sequência e voltou a marcar),
não um disparador de massa cego. Atribuição real, anti-spam e anti-duplicata.

## 2. Definições de domínio (travar antes de codificar)

- **Paciente inativo:** paciente (`status='ativo'`, não mesclado) cujo **último
  agendamento `realizada`** tem `data_agendamento <= hoje - JANELA_DIAS` **E** que **não
  tem nenhum agendamento futuro** em estado `pendente|confirmada` **E** não está em
  sequência ativa nem em opt-out.
- **Cadência (sequência):** lista ordenada de passos `{ offset_dias, template }`.
  Default proposto: D+0 (gatilho), D+7 (reforço), D+21 (oferta/última). Configurável por clínica.
- **Reativado (sucesso):** paciente que, após receber ≥1 mensagem da sequência, cria um
  novo agendamento `pendente|confirmada` com `criado_em > data do 1º envio` dentro de
  uma **janela de atribuição** (default 30 dias).
- **Opt-out:** paciente/contato que pediu para parar (palavra-chave "PARAR"/"SAIR") ou
  cujo `paciente_contato.revogado_em` está preenchido → **nunca** recebe reativação.
- **Elegibilidade de contato:** só envia para `contatos_whatsapp` com vínculo
  `paciente_contato` **titular**, `vinculo_status` ativo, `revogado_em IS NULL`.

## 3. Features por prioridade

### 🔴 Crítico (v1)
1. **Detecção de inativos** — query/elegibilidade conforme §2, multi-tenant (RLS), com
   todas as exclusões (futuro agendado, opt-out, já em sequência, sem contato válido).
2. **Tabelas de campanha** (RLS FORCE + append-only no log de envios):
   `reativacao_campanhas` (cadência por clínica), `reativacao_alvos` (paciente em
   sequência: passo atual, próximo envio, estado), `reativacao_envios` (livro-razão
   append-only: o que foi enviado, quando, resultado WAHA).
3. **Worker de disparo (n8n)** — cron diário: seleciona alvos com `proximo_envio <= now`,
   envia via WAHA `sendText`, grava em `reativacao_envios`, avança o passo. Espelha M3/M4.
   **Anti-duplicata** (não reenvia o mesmo passo) e **rate limit** (não floodar a sessão WAHA).
4. **Atribuição de retorno** — marcar alvo como `reativado` quando surge agendamento novo
   na janela; encerrar a sequência (não continua mandando para quem já voltou).
5. **Opt-out** — captura de "PARAR/SAIR" no fluxo SOFIA (router) → marca opt-out e encerra
   sequência; respeitado na detecção.
6. **Painel — página /reativacao** — listar inativos elegíveis, campanha ativa, métricas
   (enviados, respondidas, reativados, taxa), com **RBAC** (`gerir_reativacao`) e RLS.

### 🟡 Alto (v1 se couber, senão v1.1)
7. **Enrolar/parar campanha pela UI** (admin/recepção) e editar cadência.
8. **Preview do público** antes de ativar (quantos pacientes, sem disparar).
9. **Janela de silêncio** (horário comercial; não enviar fim de semana/feriado) — reusa
   padrão do M4 (cron 8–17h).

### 🔵 Nice-to-have (futuro)
10. Segmentação (por serviço/profissional/última visita), A/B de template, métrica de ROI
    (R$ recuperado estimado), digest periódico ao gestor (reusa o padrão do alerta de Estoque M5).

## 4. Tech stack (herdado — não reinventar)

- **App:** Next.js 16 (`aios-painel`, App Router, Server Actions, RSC). TS estrito.
- **Banco:** Postgres Railway (PG 18.4). **RLS FORCE** + policy `rls_tenant` via GUC
  `app.clinica_id`; role `app_painel` (NOBYPASSRLS, sem UPDATE/DELETE no livro-razão de envios).
- **DAL:** `src/server/reativacao.repo.ts` + `withTenant`/`withTenantReadOnly` (padrão Estoque).
- **RBAC:** `src/lib/rbac.ts` — nova ação `gerir_reativacao` (admin + recepção).
- **Worker:** workflow **n8n** (cron → Postgres → WAHA), padrão M3/M4. WAHA sessão `default`.
  Credenciais do n8n e do WAHA: identificadores no cofre local, fora do repositório.
- **Opt-out:** ajuste no router SOFIA — detectar palavra-chave.
- **Migração:** runner `sofia-demo/sql/_run-sql.mjs` (banco só via n8n, sem proxy público).
- **Deploy:** `railway up` (CLI) de `aios-painel/` OU MCP da raiz `D:/projetos/Demo` —
  **nunca** MCP com `path=aios-painel/`.

## 5. Constraints

- **Sem banco de staging** — migração validada por contract-test (BEGIN..ROLLBACK) + seed Aurora.
- **LGPD/consentimento** — só envia com vínculo de contato ativo e não revogado; opt-out honrado;
  livro-razão de envios é append-only e auditável.
- **Anti-spam / reputação WhatsApp** — rate limit, janela de silêncio, sem reenvio do mesmo passo,
  cap de mensagens/paciente. Risco de ban da sessão WAHA é real → conservador por default.
- **Multi-tenant** — toda leitura/escrita sob RLS; nada cross-tenant (lição M2 do Estoque: validar
  `paciente_id ∈ clínica` em qualquer INSERT que referencie paciente).
- **Idempotência** — o worker pode rodar 2× no mesmo dia sem duplicar envio (chave por passo+alvo).
- **Não quebrar a SOFIA** — qualquer mudança no router é aditiva (GET-then-PUT, comparar antes).

## 6. Exemplos input/output

**Detecção (entrada):** clínica Aurora (id=2), JANELA_DIAS=30.
→ **saída:** lista de `paciente_id` com `ultimo_atendimento`, `dias_inativo`, `chat_id` elegível.

**Envio (worker):** alvo passo 0, template "Oi {nome}, sentimos sua falta na {clinica}…".
→ **saída:** WAHA `sendText` 200; linha em `reativacao_envios(alvo_id, passo, enviado_em, wa_status)`;
alvo avança para `proximo_envio = now + offset(passo 1)`.

**Atribuição (entrada):** paciente que recebeu sequência cria agendamento `pendente`.
→ **saída:** alvo vira `status='reativado'`, `reativado_em=now`, sequência encerrada; métrica += 1.

**Opt-out (entrada):** paciente responde "PARAR".
→ **saída:** opt-out gravado; alvo `status='optout'`; nunca mais entra na detecção.

## 7. Decisões travadas (gate Fase 0 ✅ aprovado 2026-06-22)

- **D1 — Cadência default:** **JANELA_DIAS=30**; passos **D+0, D+7, D+21** (3 toques). Configurável por clínica.
- **D2 — Opt-out:** **v1 honra só `paciente_contato.revogado_em`** (não mexe na SOFIA). Captura de
  "PARAR/SAIR" no router fica para **v1.1**. (A coluna de opt-out já é gravável p/ quando v1.1 chegar.)
- **D3 — Envio:** **dry-run/preview é o default.** v1 calcula público e simula a sequência sem enviar;
  **envio real só atrás de flag explícita** (`REATIVACAO_LIVE=1` no worker) **+ cap baixo** por execução.
  Protege a reputação da sessão WAHA.
- **D4 — Superfície:** **Painel + n8n.** Página `/reativacao` (público, métricas, ligar/desligar campanha)
  + worker n8n. Visível na demo, igual aos demais módulos do painel.

---
*MAGISTER — Fase 0 ✅. Próxima: Fase 1 (ARCHITECTUS → PLANO_EXECUTIVO.md).*
