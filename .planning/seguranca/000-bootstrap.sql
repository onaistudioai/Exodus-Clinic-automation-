-- 000-bootstrap.sql — o que faltava para o sistema subir num banco VAZIO.
--
-- Motivo de existir: a Railway foi cancelada e o banco de produção se perdeu.
-- Ao reconstruir, descobriu-se que três coisas essenciais nunca foram
-- versionadas — existiam apenas no banco vivo, criadas direto em produção:
--
--   1. os roles app_painel / app_n8n (toda a RLS depende deles)
--   2. as colunas de autenticação em `usuarios` (email, senha_hash)
--   3. a função fn_login_lookup (sem ela ninguém entra no painel)
--
-- ORDEM: schema base → módulos → **este arquivo** → 003-rate-limit → 001-lockdown
--        → 002-contract-test. O GRANT ON ALL TABLES só alcança tabela que já
--        existe, por isso este script vem depois do schema, não antes.
-- Rodar como SUPERUSER/dono. Idempotente.
BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- (1) Roles da aplicação.
--
-- NOBYPASSRLS é o ponto central de todo o modelo: a RLS FORCE só constrange
-- de verdade quem não é dono da tabela e não tem bypass. Se estes roles forem
-- criados sem isso, toda a defesa de isolamento vira decoração.
--
-- A senha vem de fora (psql -v). Nunca hardcode aqui: este arquivo vai pro git.
--   psql -v painel_pwd="'...'" -v n8n_pwd="'...'" -f 000-bootstrap.sql
-- ───────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_painel') THEN
    CREATE ROLE app_painel LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_n8n') THEN
    CREATE ROLE app_n8n LOGIN;
  END IF;
END $$;

ALTER ROLE app_painel NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT;
ALTER ROLE app_n8n    NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT;

GRANT USAGE ON SCHEMA public TO app_painel, app_n8n;

-- O painel enxerga as tabelas; QUAIS LINHAS é a RLS que decide.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_painel;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_painel;

-- DELETE fica de fora de propósito: o modelo é append-only + status.
-- Prontuário e ledger financeiro não se apagam; expurgo LGPD é lógico.
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM app_painel, app_n8n;

-- Tabela nova criada depois deste script já nasce visível para o painel.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO app_painel;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_painel;

-- ───────────────────────────────────────────────────────────────────────────
-- (2) Colunas de autenticação em `usuarios`.
--     O DRAFT versionado (sofia-demo/sql/DRAFT-prontuario-modelo.sql) tem só
--     nome/papel/ativo — email e senha_hash foram adicionados em produção.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email      text;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_hash text;

-- Email é único POR CLÍNICA, não global: a mesma pessoa pode atender duas
-- clínicas com o mesmo e-mail. É por isso que fn_login_lookup pode devolver
-- mais de uma linha e o auth.ts compara o bcrypt contra cada uma.
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_email_por_clinica
  ON usuarios (clinica_id, lower(email)) WHERE email IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- (3) fn_login_lookup — o furo mais crítico do inventário.
--
-- O login roda FORA do withTenant: ainda não há tenant, é o login que o
-- descobre. Um SELECT direto em `usuarios` voltaria 0 linhas (RLS FORCE +
-- NOBYPASSRLS sem GUC = fail-closed). SECURITY DEFINER escapa a RLS apenas
-- para este lookup.
--
-- Cuidados que fazem isso ser seguro apesar do DEFINER:
--   - search_path fixo (senão o dono do schema poderia sequestrar a resolução)
--   - devolve APENAS o necessário para autenticar
--   - EXECUTE só para app_painel, revogado de PUBLIC
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
