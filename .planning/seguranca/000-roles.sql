-- 000-roles.sql — cria os roles da aplicação. RODA ANTES DE TUDO.
--
-- ORDEM (descoberta ao reconstruir do zero num Neon limpo):
--   **este arquivo** → schema base → módulos → 004-auth-e-grants → 003-rate-limit
--   → 001-lockdown → 002-contract-test
--
-- Por que primeiro: todo 001-*.sql de módulo termina com GRANT ... TO app_painel.
-- Sem os roles, cada módulo falha com 'role "app_painel" does not exist'.
--
-- Por que os atributos vêm no CREATE e não em ALTER ROLE depois: em Postgres
-- gerenciado (Neon, RDS) o dono do banco NÃO é superuser, e `ALTER ROLE` falha
-- com 'permission denied to alter role'. Na criação funciona, porque quem tem
-- CREATEROLE define os atributos do que cria.
--
-- NOBYPASSRLS é o pilar do modelo: a RLS FORCE só constrange quem não é dono da
-- tabela e não tem bypass. Role criado sem isso transforma todo o isolamento
-- multi-tenant em decoração.
--
-- Senha: passe por fora, este arquivo vai pro git.
--   psql -v painel_pwd="'...'" -f 000-roles.sql
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_painel') THEN
    CREATE ROLE app_painel LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_n8n') THEN
    CREATE ROLE app_n8n LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END $$;

-- Se o role já existia com atributo errado, ALTER pode não ser permitido —
-- então falhamos alto em vez de seguir com uma falsa sensação de isolamento.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
            WHERE rolname IN ('app_painel','app_n8n') LOOP
    IF r.rolsuper OR r.rolbypassrls THEN
      RAISE EXCEPTION
        'Role % escapa da RLS (super=%, bypass=%). Recrie-o: DROP ROLE %; e rode este arquivo de novo.',
        r.rolname, r.rolsuper, r.rolbypassrls, r.rolname;
    END IF;
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO app_painel, app_n8n;

-- O dono do banco precisa ser MEMBRO dos roles para poder `SET ROLE` — é assim
-- que o contract-test desce para app_painel e prova que a RLS constrange.
-- Sem isto: 'permission denied to set role'. Não enfraquece nada: o dono já tem
-- poder total sobre o banco; isto só o deixa se rebaixar para testar.
DO $$
BEGIN
  EXECUTE format('GRANT app_painel, app_n8n TO %I', current_user);
END $$;

COMMIT;
