-- 002-contract-test.sql — prova as garantias de ISOLAMENTO do sistema inteiro.
--
-- Segue o padrão dos contract-tests por módulo (.planning/*/sql/00X-contract-test.sql):
-- auto-verificável (RAISE EXCEPTION em cada falha) e sem lixo (BEGIN ... ROLLBACK).
--
-- Diferença: aqui nada é enumerado à mão. As asserções varrem o catálogo, então
-- uma tabela nova sem RLS QUEBRA este teste — que é exatamente o que se quer.
--
-- Rodar como SUPERUSER (as checagens de RLS descem para `SET LOCAL ROLE app_painel`,
-- que é NOBYPASSRLS; só assim a RLS FORCE constrange de verdade).
BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- (1) Toda tabela com clinica_id tem RLS habilitada, FORÇADA e com policy.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE faltando text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO faltando
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r'
     AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attname = 'clinica_id'
                    AND a.attnum > 0 AND NOT a.attisdropped)
     AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
          OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname));

  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA(1): tabelas multi-tenant sem RLS FORCE/policy: %', faltando;
  END IF;
  RAISE NOTICE 'OK(1): todas as tabelas multi-tenant têm RLS FORCE + policy.';
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- (2) Os roles da aplicação não conseguem escapar da RLS.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
            WHERE rolname IN ('app_painel','app_n8n') LOOP
    IF r.rolsuper OR r.rolbypassrls THEN
      RAISE EXCEPTION 'FALHA(2): role % escapa da RLS (super=% bypass=%)',
        r.rolname, r.rolsuper, r.rolbypassrls;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK(2): app_painel e app_n8n são NOSUPERUSER + NOBYPASSRLS.';
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- (3) FAIL-CLOSED: sem o GUC de tenant, NENHUMA tabela devolve linha.
--     É a garantia mais importante — o modo de falha é "não vê nada".
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text; n bigint; vazando text := '';
BEGIN
  PERFORM set_config('app.clinica_id', '', true);  -- sem tenant
  SET LOCAL ROLE app_painel;

  FOR t IN
    SELECT c.relname FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname='public' AND c.relkind='r' AND c.relrowsecurity
       AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid
                    AND a.attname='clinica_id' AND a.attnum>0 AND NOT a.attisdropped)
  LOOP
    EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
    IF n > 0 THEN vazando := vazando || t || '(' || n || ') '; END IF;
  END LOOP;

  RESET ROLE;
  IF vazando <> '' THEN
    RAISE EXCEPTION 'FALHA(3): sem GUC, estas tabelas devolveram linhas: %', vazando;
  END IF;
  RAISE NOTICE 'OK(3): fail-closed confirmado — sem tenant, zero linhas.';
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- (4) CRUZAMENTO DE CLÍNICA: com tenant A setado, nenhuma linha de outro
--     tenant aparece. Roda contra os dados reais que existirem no banco.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text; n bigint; alvo int; vazando text := '';
BEGIN
  SELECT min(id) INTO alvo FROM clinicas;
  IF alvo IS NULL THEN RAISE EXCEPTION 'FALHA(4): sem clínicas cadastradas para testar.'; END IF;

  PERFORM set_config('app.clinica_id', alvo::text, true);
  SET LOCAL ROLE app_painel;

  FOR t IN
    SELECT c.relname FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname='public' AND c.relkind='r' AND c.relrowsecurity
       AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid
                    AND a.attname='clinica_id' AND a.attnum>0 AND NOT a.attisdropped)
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE clinica_id <> $1', t) INTO n USING alvo;
    IF n > 0 THEN vazando := vazando || t || '(' || n || ') '; END IF;
  END LOOP;

  RESET ROLE;
  IF vazando <> '' THEN
    RAISE EXCEPTION 'FALHA(4): vazamento entre clínicas em: %', vazando;
  END IF;
  RAISE NOTICE 'OK(4): nenhum vazamento entre clínicas (tenant=%).', alvo;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- (5) WITH CHECK: não dá para GRAVAR numa clínica que não é a da sessão.
--     Sem isso, um bug de app escreveria dado no tenant errado.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE alvo int; outro int; deu_erro boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='reativacao_campanhas' AND relkind='r') THEN
    RAISE NOTICE 'PULADO(5): reativacao_campanhas não existe neste banco.';
    RETURN;
  END IF;

  SELECT min(id), max(id) INTO alvo, outro FROM clinicas;
  IF alvo IS NULL OR alvo = outro THEN
    RAISE NOTICE 'PULADO(5): são necessárias 2 clínicas para testar escrita cruzada.';
    RETURN;
  END IF;

  PERFORM set_config('app.clinica_id', alvo::text, true);
  SET LOCAL ROLE app_painel;
  BEGIN
    EXECUTE format('INSERT INTO reativacao_campanhas (clinica_id, nome) VALUES (%s, %L)',
                   outro, '[TESTE] escrita cruzada');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    deu_erro := true;
  END;
  RESET ROLE;

  IF NOT deu_erro THEN
    RAISE EXCEPTION 'FALHA(5): sessão do tenant % conseguiu gravar no tenant %.', alvo, outro;
  END IF;
  RAISE NOTICE 'OK(5): WITH CHECK bloqueia escrita em clínica alheia.';
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- (6) app_n8n não enxerga texto clínico (prontuário).
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE pode boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='prontuario_entradas' AND relkind='r') THEN
    RAISE NOTICE 'PULADO(6): prontuario_entradas não existe neste banco.';
    RETURN;
  END IF;
  SELECT has_table_privilege('app_n8n', 'prontuario_entradas', 'SELECT') INTO pode;
  IF pode THEN
    RAISE EXCEPTION 'FALHA(6): app_n8n tem SELECT em prontuario_entradas (texto clínico).';
  END IF;
  RAISE NOTICE 'OK(6): app_n8n sem acesso ao prontuário.';
END $$;

ROLLBACK;
