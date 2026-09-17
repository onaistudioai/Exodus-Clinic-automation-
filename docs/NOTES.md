# aios-painel — notas de execução (PROC-B)

Painel Next 16 do AIOS.clinic: auth + check-in, sobre **Postgres no Neon** (não Supabase),
conectando como role `app_painel` (não-dono → RLS FORCE vale). App **novo**, separado da
demo `aios-clinicas`. Contrato de schema: `sofia-demo/sql/DRAFT-*`.

## Estado (2026-06-15)

| Escopo | Status |
|---|---|
| B1 Scaffold Next 16 + pg | ✅ build verde |
| B2 `withTenant()` (§0.2) | ✅ `src/lib/tenant.ts` |
| B3 Auth real (§0.3) | ✅ sessão JWT + `fn_login_lookup` (AUTH-RLS resolvido por A) |
| B4 RBAC (§0.4) | ✅ `src/lib/rbac.ts` |
| B5 UI Check-in | ✅ busca-antes-de-criar + desambiguação + criar-novo + fechar-check-in (carimbo) + **merge** (fora do balcão, dupla confirmação) — todos com E2E live |
| **Wave 2 — Prontuário** | ✅ busca (médico/admin) + `/prontuario/[id]` (histórico c/ texto clínico, registrar atendimento, correção append-only, auditoria) — E2E live |
| **Governança** | ✅ `/pacientes/[id]` (recepção: ficha + etiquetas, SEM texto clínico) + `/admin/auditoria` (admin: trilha prontuario_acessos) — E2E live + RBAC negativo |
| **Deploy** | 🔴 **fora do ar desde 2026-07-27.** O serviço do painel vivia numa hospedagem cuja assinatura foi cancelada, e a URL de então está morta. Destino registrado: Vercel (`docs/DEPLOY.md` §2) |

## Governança — etiquetas (recepção) + auditoria (admin) (feito 2026-06-16)
Fecha o ciclo do prontuário com as duas views read-only que faltavam.
- `prontuario.repo.ts` +`listarAcessos(limite)` — trilha (join usuarios+pacientes, RLS por GUC).
- `/admin/auditoria/page.tsx` (gate `ver_auditoria` = admin) — lista os últimos N acessos
  (quem/papel → paciente, ação, entrada, detalhe, quando). Read-only/imutável.
- `/pacientes/[id]/page.tsx` (gate `checkin` = recepção/admin) — ficha + ETIQUETAS
  (`listarEtiquetas`: estado/tipo/precisa_retorno/data) **sem** texto clínico (decisão §0.4).
- `BuscaPaciente.tsx` — link "ficha" por resultado → `/pacientes/[id]` (reachability p/ recepção).
- ✅ **E2E live (2026-06-16):** admin (seed id4) → nav mostra Auditoria, `/admin/auditoria`
  lista os acessos reais do teste do médico (leu/criou/finalizou/corrigiu). Recepção (id2)
  → `/pacientes/7` mostra etiqueta "limpeza" e OCULTA o texto clínico; e é BLOQUEADA de
  `/admin/auditoria` e `/prontuario/7` (RBAC negativo). Seed limpo: entrada exemplo expurgada,
  admin `ativo=false`.

## WAVE 2 — Prontuário (feito 2026-06-16) — gate médico
Fluxo [ATENDIMENTO] da ARCHITECTURE §6. DAL já existia (`prontuario.repo.ts`); criei UI+actions.
- `agendamentos.repo.ts` +`listarVinculaveis(pacienteId)` — agend. pendente/confirmada DESTE
  paciente p/ o médico anexar (finalizar marca 'realizada' via trigger).
- `prontuario/page.tsx`+`BuscaProntuario.tsx`+`actions.ts` — busca paciente (gate
  `ler_texto_clinico` = médico/admin) → link p/ `/prontuario/[id]`.
- `prontuario/[pacienteId]/page.tsx` — carrega ficha+entradas+agend. e registra `leu` na
  auditoria, TUDO em 1 withTenant (read-write p/ o INSERT de acesso). `params` é async (Next 16).
- `prontuario/[pacienteId]/actions.ts` `registrarAtendimento` — cria rascunho (ou correção
  c/ `corrige_entrada_id`) → finaliza → audita (criou/corrigiu + finalizou), 1 transação.
  Gate `criar_entrada_prontuario` = **só médico** (admin lê, não cria). Valida tags antes
  do constraint `chk_finalizado_exige_tags`. `revalidatePath` atualiza a lista.
- `ProntuarioPaciente.tsx` — histórico c/ texto clínico completo + form (texto/tipo/retorno/
  orientações + vínculo de agendamento) + "Corrigir (nova entrada)" em finalizadas. Bug
  corrigido: após sucesso `state.ok` ficava true e travava reabrir o form → fechar via
  `useEffect([state.ok, state.entradaId])`.
- ✅ **E2E live (2026-06-16):** semeei médico (medico.teste@aurora.local, id3) + agend.
  confirmada (id4, paciente 7). Playwright: login médico → nav mostra Prontuário e NÃO
  Check-in (RBAC) → busca "mar" → abre → registra atendimento (0→1, texto visível) →
  Corrigir → NOVA entrada (1→2). DB confirmou: entrada #2 `corrige_entrada_id=1`
  (append-only), agendamento #4 → **'realizada'** (trigger de finalização).
- Limpeza pós-teste: append-only BLOQUEIA DELETE (e bypass via session_replication_role
  é tratado como adulteração de auditoria — corretamente barrado). Limpei pelo caminho
  sancionado: **expurgo lógico** (UPDATE permitido pelo trigger, nula texto, preserva linha)
  + médico `ativo=false`. Sobram (auditáveis, por design): 2 entradas expurgadas + agend.
  'realizada' + acessos do prontuario_acessos + médico desativado. Hard-delete exigiria
  autorização explícita p/ furar o append-only.

## WAVE 0 — Arquitetura (feito 2026-06-16)
Ver `ARCHITECTURE.md` (nesta pasta). Camadas: UI → Action (autoriza+valida)
→ Repository (`src/server/*.repo.ts`, recebe `tx`) → withTenant → Postgres (RLS).
- `src/types/domain.ts` — tipos de domínio compartilhados.
- `src/server/{pacientes,agendamentos,prontuario}.repo.ts` — DAL (pacientes+agend. usados; prontuário pronto p/ Wave 2).
- Check-in refatorado p/ usar `pacientes.repo` (queries.ts removido).
- Route group `(painel)/` com layout protegido (verifySession 1x + nav por papel + logout). URLs inalteradas.
- Rotas-esqueleto: `/prontuario` (gate médico), `/admin/auditoria` (gate admin).
- Build limpo: rotas /, /checkin, /prontuario, /admin/auditoria, /login.

## B5 — merge de pacientes (feito 2026-06-16) — FECHA O B5
Última peça (DRAFT-checkin-ux.md §MERGE): unir duas fichas duplicadas. Ação destrutiva
→ página própria `/merge` (fora do balcão), dupla confirmação digitando o NOME do destino.
- `pacientes.repo.ts` — `resumoParaMerge` (dados + contagem do que será movido; agend. fora
  da RLS → filtro explícito) e `mesclar` (move agendamentos + prontuário p/ destino, marca
  origem `status='mesclado'`+`mesclado_para_id`). Merge é LÓGICO: nada apagado, auditável,
  reversível à mão. Trigger append-only do prontuário NÃO bloqueia troca de paciente_id.
- `merge/actions.ts` — `buscarParaMerge`/`carregarResumo`/`mesclarPacientes` (RPC chamadas
  direto do client). Validação server-side: ambos ativos, ids ≠, e **nome digitado === nome
  do destino** (a confirmação é re-checada no servidor, não só na UI). Tudo em 1 withTenant.
- `merge/MergePacientes.tsx` — 2 slots lado a lado (Manter/Absorver), busca+escolhe em cada;
  bloco de confirmação só habilita "Mesclar" quando o nome bate. `merge/page.tsx` (RBAC
  checkin). Link "Mesclar" no nav (`(painel)/layout.tsx`, recepcao/admin).
- ✅ **E2E live (2026-06-16):** semeei 2ª ficha "mar duplicata" (id9) + 1 agendamento nela →
  Playwright: login → /merge → destino "mar" (id7) + origem "duplicata" → nome errado mantém
  botão TRAVADO, nome certo libera → Mesclar → "1 agendamento movido para mar". DB confirmou:
  agendamento passou p/ paciente_id=7, origem id9 `status='mesclado' mesclado_para_id=7`.
  Dados de teste removidos.
- ⚠️ Playwright gotcha: inputs CONTROLADOS (value+onChange) do merge não atualizam estado com
  `.fill()` → usar `.pressSequentially()` (digitação real). (login/check-in usam inputs
  não-controlados, `.fill()` funciona neles.)

## B5 — fechar check-in / carimbo de identidade (feito 2026-06-16)
Liga TRAVA 2 do banco (DRAFT-checkin-ux.md §Fechamento): confirmar identidade carimba
`paciente_id` + `identidade_confirmada_em/por` no `agendamentos_sofia_demo` — fecha o
buraco entre quem agendou (Sofia, por chat_id/telefone) e quem sentou na cadeira.
- `checkin/fechar-actions.ts` — `gerenciarCheckin` (1 action, `intent` carregar|confirmar →
  1 useActionState). `clinica_id` da sessão; usa DAL `listarAbertosPorPaciente` +
  `confirmarIdentidade` (já existiam em `agendamentos.repo.ts`). agend. está fora da RLS →
  filtro por `current_setting('app.clinica_id')` dentro de `withTenant` é a trava.
- `checkin/FecharCheckin.tsx` — auto-carrega agendamentos abertos (hoje/amanhã) do paciente;
  cada um vira botão "Confirmar identidade". Badge "✓ confirmada" se já carimbado; badge
  "⚠ vinculado a outro paciente" (sem botão) se `paciente_id` já é de outro → manda pro merge.
- `BuscaPaciente.tsx` — "Selecionar" (agora `type=button`) abre o fechamento; `CriarPaciente`
  ganhou `onCheckin` → botão "Iniciar check-in →" na tela de sucesso (criar→fechar sem re-buscar).
- tsc + `next build`: verdes.
- ✅ **E2E live (2026-06-16):** redeploy OK + semeei 1 agendamento `pendente` p/ Aurora →
  Playwright/Chrome: login → buscar "mar" → Selecionar → lista carregou o agendamento →
  "Confirmar identidade" → msg sucesso + badge "✓ identidade confirmada". DELETE de
  verificação confirmou no banco: `paciente_id=7`, `identidade_confirmada_por=2`,
  `identidade_confirmada_em` carimbados. Agendamento de teste removido pós-prova.
- ⚠️ **Deploy gotcha:** `aios-painel` é subpasta de um repo git cujo root é `D:\projetos\Demo`;
  `railway up` sobe a partir do **root do git** (ignora o cwd). Fix permanente aplicado:
  setei `root_directory=aios-painel` no serviço (via Railway MCP `update_service`). Os 2
  primeiros deploys falharam (Railpack analisou o root e não achou app Node) até esse fix.

## B5 — criar novo paciente (feito 2026-06-16)
- `src/lib/idade.ts` — calcularIdade/eMenor/validarNascimento (espelha fn_e_menor; bloqueia futuro/>120a).
- `src/app/checkin/criar-actions.ts` — `criarPaciente`: valida server-side, CPF→hash+last4 (23505=CPF dup), menor→cria responsável (paciente) + vínculo `paciente_responsavel` + consentimento, TUDO em 1 `withTenant` (atômico).
- `CriarPaciente.tsx` — date-picker (max=hoje) mostra idade ao vivo; revela bloco responsável se <18. Ligado no `BuscaPaciente` (botão pós-busca pré-preenche nome/CPF buscado).

## Deploy (live)
- URL (morta desde 2026-07-27) — na época `/login` 200, `/` e `/checkin` → 307 /login.
- Conecta como `app_painel` via `DATABASE_URL`. As três vars (DATABASE_URL, AUTH_SECRET, CPF_PEPPER, cofre `exodus/painel.env` + `postgres.env`) precisam ser recriadas como environment variables da Vercel.
- Container "Ready in 176ms", sem erro de conexão no boot.

## Prova de RLS end-to-end
1. ✅ Usuário de teste semeado: `usuarios.id=2`, clinica_id=2, papel=recepcao,
   email `teste.recepcao@aurora.local`, senha `aurora-teste-2026`
   (via `sofia-demo/sql/_seed-usuario-teste-aurora.sql`).
2. ✅ Teste E2E no app deployado (2026-06-16, via Playwright/Chrome contra
   na URL de então): login real como
   `teste.recepcao@aurora.local` → sessão emitida (cookie `aios_painel_session`,
   clinica_id=2). Check-in: busca "isca" (paciente-isca semeado na clínica 1) →
   **0 resultados** ("Nenhum paciente encontrado") = Aurora NÃO vê dado da clínica 1;
   busca "mar" (paciente da Aurora) → 1 resultado. RLS isola pela cadeia completa
   real: bcrypt + `fn_login_lookup` → JWT clinica_id → `withTenant` → role
   `app_painel` (NOBYPASSRLS) → policy `rls_tenant`. Isca da clínica 1 removida pós-teste.

> Limpeza pós-demo: o usuário de teste (id=2) pode ser desativado
> (`UPDATE usuarios SET ativo=false WHERE id=2`) quando não for mais necessário.

## Breaking changes do Next 16 já aplicados (vs. treino)
- **Middleware → Proxy**: lógica em `proxy.ts` (raiz), função `proxy()`. Só check otimista
  (presença do cookie); verificação real no DAL.
- Turbopack é o bundler padrão. `next build` **não** roda mais o linter.
- Route Handlers: `ctx.params` é **assíncrono** (`await ctx.params`).
- `searchParams`/`cookies()`/`headers()` são assíncronos (já tratados).

## Decisão registrada: Auth.js v5 → sessão sobre `jose`
O plano travou "Auth.js v5 (NextAuth)". Implementado sobre `jose` (a mesma lib que o
next-auth usa por baixo) + `bcryptjs`, seguindo o padrão **DAL** dos docs do Next 16.
Motivos: (1) schema ainda não está vivo (sync A); (2) o wrapper `auth` do next-auth assume
`middleware.ts`, que o Next 16 renomeou para `proxy.ts`. Os **claims são idênticos ao
contrato** (`usuario_id`, `clinica_id`, `papel`), então migrar para next-auth depois é
local (`session.ts` + `auth.ts`). **Confirmar com o dono** se mantém jose ou volta pro next-auth.

## Sync points com Processo A (bloqueiam rodar de verdade)
- **A1** — role `app_painel` + senha → preencher `DATABASE_URL` no `.env.local`.
- **A2** — schema aplicado (`DRAFT-prontuario-modelo.sql`) com RLS valendo.
  - Migration que A precisa adicionar em `usuarios`: `email TEXT`, `senha_hash TEXT`,
    `CREATE UNIQUE INDEX uq_usuarios_email ON usuarios (clinica_id, lower(email))`.
- **AUTH-RLS** ⚠️ — o login (`autenticar()`) consulta `usuarios` **fora** do `withTenant`
  (ainda não há tenant; é o login que o descobre). Mas `usuarios` está sob RLS FORCE no
  DRAFT → com `app_painel` (NOBYPASSRLS) e sem GUC setado, o SELECT do login retorna 0 linhas
  (fail-closed) e **ninguém loga**. Resolver com A na Fase 0, opções:
    1. `usuarios` fora da RLS (é metadado de operador, não dado de paciente); OU
    2. uma policy de login específica; OU
    3. um lookup de login por um caminho com o GUC setado a partir do email→clinica.
  **Provar quando A2 entregar.**

## Prova de RLS fail-closed (rodar quando A2 entregar)
Logar como clínica X e confirmar que NÃO vê pacientes da clínica Y (a policy `rls_tenant`
filtra por `current_setting('app.clinica_id')`, setado só pelo `withTenant`).

## Próximo no B5 (UX travas restantes — DRAFT-checkin-ux.md)
Criar-novo (calendário com bloqueio futuro/>120a + idade ao lado), menor → responsável +
consentimento, número reciclado → `a_reconfirmar`, merge fora do fluxo (dupla confirmação
digitando o nome), fechamento carimba `identidade_confirmada_*` + `paciente_id`.
