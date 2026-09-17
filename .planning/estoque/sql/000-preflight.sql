-- 000-preflight.sql — checagem read-only de pré-requisitos ANTES de aplicar 001.
-- Cada coluna NULL = pré-requisito FALTANDO (não aplicar a migration nesse caso).
-- 'produtos_ja_existe' não-NULL = migration provavelmente já rodou (001 é idempotente).
SELECT
  to_regclass('public.clinicas')                 AS clinicas,
  to_regclass('public.usuarios')                 AS usuarios,
  to_regclass('public.prontuario_entradas')      AS prontuario_entradas,
  to_regclass('public.agendamentos_sofia_demo')  AS agendamentos_sofia_demo,
  (SELECT rolname FROM pg_roles WHERE rolname = 'app_painel') AS role_app_painel,
  to_regclass('public.produtos')                 AS produtos_ja_existe;
