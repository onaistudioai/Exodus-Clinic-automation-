-- 004-auth-e-grants.sql — autenticação + privilégios. RODA DEPOIS DO SCHEMA.
--
-- Complementa 000-roles.sql (que só cria os roles, antes do schema). Aqui vai
-- tudo que precisa das tabelas já existindo.
--
-- Preenche o que nunca foi versionado e existia só no banco morto da Railway:
--   - colunas de autenticação em `usuarios`
--   - a função fn_login_lookup
BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- (1) Privilégios. QUAIS LINHAS continua sendo decisão da RLS.
-- ───────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_painel;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_painel;

-- DELETE fica de fora de propósito: o modelo é append-only + status.
-- Prontuário e ledger financeiro não se apagam; expurgo LGPD é lógico.
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM app_painel, app_n8n;

-- Tabela criada depois deste ponto já nasce visível para o painel.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO app_painel;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_painel;

-- ───────────────────────────────────────────────────────────────────────────
-- (2) Colunas de autenticação.
--     O schema versionado (DRAFT-prontuario-modelo.sql) tem só nome/papel/ativo
--     — email e senha_hash foram adicionados direto em produção.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email      text;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_hash text;

-- Email é único POR CLÍNICA, não global: a mesma pessoa pode atender duas
-- clínicas com o mesmo e-mail. É por isso que fn_login_lookup pode devolver
-- mais de uma linha e o auth.ts compara o bcrypt contra cada uma.
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_email_por_clinica
  ON usuarios (clinica_id, lower(email)) WHERE email IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- (3) fn_login_lookup — o furo mais crítico do inventário pós-Railway.
--
-- O login roda FORA do withTenant: ainda não há tenant, é o login que o
-- descobre. Um SELECT direto em `usuarios` voltaria 0 linhas (RLS FORCE +
-- NOBYPASSRLS sem GUC = fail-closed). SECURITY DEFINER escapa a RLS apenas
-- para este lookup.
--
-- O que torna isso seguro apesar do DEFINER:
--   - search_path fixo (senão o dono do schema sequestraria a resolução)
--   - devolve só o necessário para autenticar
--   - EXECUTE apenas para app_painel, revogado de PUBLIC
--   - filtra ativo = true: desligado não entra
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_login_lookup(p_email text)
RETURNS TABLE (
  id         int,
  clinica_id int,
  papel      text,
  senha_hash text,
  nome       text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.clinica_id, u.papel, u.senha_hash, u.nome
    FROM usuarios u
   WHERE lower(u.email) = lower(p_email)
     AND u.ativo = true
     AND u.senha_hash IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION fn_login_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_login_lookup(text) TO app_painel;

COMMIT;
