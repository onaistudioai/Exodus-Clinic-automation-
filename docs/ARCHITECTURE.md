# Arquitetura — aios-painel (módulo Prontuário/Check-in)

> Painel clínico do AIOS.clinic. Onde o atendimento sai do WhatsApp (SOFIA) e entra na
> operação da clínica: check-in, identidade, prontuário. Multi-tenant com isolamento
> real (RLS). Stack: Next.js 16 (App Router) + Postgres (Neon) via `pg`.

## 1. Princípios

1. **Tenant sempre da sessão, nunca do cliente.** Todo acesso a dado passa por
   `withTenant(clinica_id)` → seta `app.clinica_id` (GUC LOCAL) → a RLS isola.
2. **Segurança perto do dado.** Proxy faz só check otimista; a autorização real é no
   servidor (DAL `verifySession` + `requireAcao`) e no banco (RLS FORCE + grants).
3. **Camadas finas e explícitas.** UI → Server Action → Repository (DAL) → Postgres.
   Action valida + autoriza; Repository só fala SQL; nada de SQL solto em componente.
4. **Append-only no clínico.** Prontuário finalizado é imutável (corrige criando nova
   entrada); expurgo lógico para LGPD. Regras no banco (trigger), não só no app.
5. **Papel decide o que se vê.** recepção / médico / admin. Recepção nunca lê texto clínico.

## 2. Camadas

```
┌─────────────────────────────────────────────────────────────┐
│  src/app/**            UI (Server/Client Components) + rotas  │
│                        Server Actions ("use server")         │
│                        ↓ valida (zod-like manual) + autoriza  │
├─────────────────────────────────────────────────────────────┤
│  src/lib/rbac, dal     Autorização: verifySession, requireAcao│
├─────────────────────────────────────────────────────────────┤
│  src/server/*.repo.ts  Data Access Layer (DAL): SQL por domínio│
│                        funções recebem `tx` (compõem 1 trans.)│
├─────────────────────────────────────────────────────────────┤
│  src/lib/tenant        withTenant / withTenantReadOnly (GUC)  │
│  src/lib/db            pool pg (role app_painel, lazy)        │
├─────────────────────────────────────────────────────────────┤
│  Postgres (Neon)       RLS FORCE + policy rls_tenant + grants │
└─────────────────────────────────────────────────────────────┘
```

Cross-cutting em `src/lib/`: `session` (JWT), `auth` (credenciais via fn_login_lookup),
`cpf` (hash+last4), `idade` (validação/menoridade), `db`, `tenant`, `dal`, `rbac`.

### Contrato Repository
- Cada função recebe `tx: Tx` (cliente da transação aberta por `withTenant`).
- **Nunca** abre transação própria nem lê a sessão — quem chama (Action) faz isso.
- Assim várias operações compõem **uma** transação atômica (ex.: criar menor +
  responsável + vínculo) sob o **mesmo** tenant GUC.

### Contrato Server Action
1. `await requireAcao(<acao>)` — RBAC (lança se papel não pode).
2. `const s = await verifySession()` — pega `clinica_id`/`usuario_id` do JWT.
3. Valida input (helpers de `lib/idade`, `lib/cpf`).
4. `withTenant(s.clinica_id, tx => repo.x(tx, ...))` — executa.
5. Retorna estado tipado (`{ ok }` | `{ erro, campo }`).

## 3. Mapa de rotas (App Router)

```
/login                              público (proxy libera)
(painel)/                           grupo com layout protegido (verifySession + nav por papel)
  /                                 dashboard (cards por papel)
  /checkin                          recepção+admin: buscar → criar → confirmar identidade
  /pacientes/[id]                   ficha do paciente (dados + etiquetas; sem texto clínico p/ recepção)
  /prontuario/[pacienteId]          médico+admin: ler/escrever entradas (append-only)
  /pacientes/merge                  recepção+admin: mesclar duplicatas (dupla confirmação)
  /admin/auditoria                  admin: prontuario_acessos
  /admin/usuarios                   admin: gestão de operadores (futuro)
```

> Route groups `()` não mudam URL. `(painel)/layout.tsx` roda `verifySession()` uma vez
> e desenha a navegação conforme `papel`. Cada página ainda chama `requireAcao` da sua ação.

## 4. Domínios e repositórios

| Domínio | Arquivo | Funções (DAL) |
|---|---|---|
| Pacientes | `src/server/pacientes.repo.ts` | `buscarPorNome`, `buscarPorCpf`, `criar`, `obterPorId`, `mesclar`, `marcarReconfirmar` |
| Agendamentos | `src/server/agendamentos.repo.ts` | `confirmarIdentidade`, `listarPorPaciente`, `consultasSemDesfecho` |
| Prontuário | `src/server/prontuario.repo.ts` | `listarPorPaciente`, `criarRascunho`, `finalizar`, `corrigir`, `expurgar`, `registrarAcesso` |
| Responsável | (em pacientes.repo) | `vincularResponsavel` |

Tipos de domínio compartilhados em `src/types/domain.ts`.

## 5. Modelo de segurança (resumo)

- **Conexão:** role `app_painel` (NOBYPASSRLS, não-dono) → RLS realmente constrange.
- **Isolamento:** policy `rls_tenant` (USING/WITH CHECK `clinica_id = current_setting('app.clinica_id')`).
  Sem GUC → 0 linhas (fail-closed). GUC setado só pelo `withTenant`.
- **Login:** `fn_login_lookup` (SECURITY DEFINER) escapa a RLS só para o lookup de auth.
- **Sessão:** JWT httpOnly (`usuario_id`, `clinica_id`, `papel`), 8h.
- **RBAC:** matriz em `lib/rbac.ts`, gate `requireAcao` no servidor.
- **CPF:** nunca em claro — `sha256(cpf||pepper)` + last4; pepper em env.

## 6. Fluxo ponta-a-ponta (alvo)

```
SOFIA agenda (WhatsApp) → agendamentos_sofia_demo (status pendente/confirmada)
        │
   paciente chega
        ▼
[CHECK-IN] recepção busca → acha/cria paciente → CONFIRMA IDENTIDADE
        │   (carimba paciente_id + identidade_confirmada_* no agendamento)
        ▼
[ATENDIMENTO] médico abre PRONTUÁRIO do paciente → cria entrada (rascunho)
        │   finaliza → trigger marca agendamento 'realizada'
        ▼
[GOVERNANÇA] admin vê auditoria / expurgo LGPD
```

## 7. Convenções
- Arquivos/rotas em pt-BR (domínio clínico em português, alinhado ao schema).
- Server Actions co-localizadas na feature (`app/<feature>/actions.ts`), finas.
- Componentes compartilhados em `src/components/`.
- Sem ORM: SQL explícito nos repos (contrato = `DRAFT-prontuario-modelo.sql`).
- Erros de usuário = estado tipado retornado; erros de sistema = throw (boundary do Next).
