-- 001-lockdown.sql — cadeado de segurança transversal (S2/S7).
--
-- Diferente dos lockdowns por módulo, este NÃO enumera tabelas: ele varre o
-- catálogo e aplica a regra a TODA tabela que tenha `clinica_id`. Assim, tabela
-- nova (agenda, turnos, CRM, e o que vier) já nasce coberta — o modo de falha
-- deixa de ser "alguém esqueceu de adicionar na lista".
--
-- Rodar como SUPERUSER/dono. Idempotente.
BEGIN;

-- (1) RLS FORCE + policy de tenant em toda tabela multi-tenant.
DO $$
DECLARE t text; n int := 0;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public'
       AND c.relkind = 'r'
       AND EXISTS (
         SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'clinica_id' AND a.attnum > 0 AND NOT a.attisdropped
       )
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);

    -- Policy padrão: fail-closed. Sem o GUC, current_setting devolve '' ->
    -- NULLIF -> NULL -> comparação NULL -> zero linhas. Nunca "vê tudo".
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'rls_tenant') THEN
      EXECUTE format($f$
        CREATE POLICY rls_tenant ON %I
          USING (clinica_id = NULLIF(current_setting('app.clinica_id', true), '')::int)
          WITH CHECK (clinica_id = NULLIF(current_setting('app.clinica_id', true), '')::int);
      $f$, t);
    END IF;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'RLS FORCE garantido em % tabelas multi-tenant.', n;
END $$;

-- (2) Roles da aplicação nunca podem escapar da RLS.
--     Dono de tabela ignora a própria policy; superuser ignora tudo.
ALTER ROLE app_painel NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
ALTER ROLE app_n8n    NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- (3) S2 — o n8n deixa de falar com o banco. Toda escrita da SOFIA passa a
--     entrar por /api/sofia/* (HMAC + withTenant + auditoria).
--     Executar SOMENTE após a Wave 3 migrar os 4 workflows; até lá, o REVOKE
--     abaixo derruba a SOFIA. Deixado explícito e comentado de propósito.
--
-- REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_n8n;
-- REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_n8n;
-- REVOKE ALL ON SCHEMA public FROM app_n8n;

-- (4) Enquanto a Wave 3 não conclui: privilégio mínimo, sem DELETE em lugar
--     nenhum e sem acesso ao que é clínico.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_n8n;
GRANT USAGE ON SCHEMA public TO app_n8n;
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'reativacao_alvos','reativacao_envios','reativacao_campanhas',
    'consentimento_eventos','escalonamentos'
  ]) LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relkind = 'r') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO app_n8n;', t);
    END IF;
  END LOOP;
END $$;

-- Prontuário é texto clínico: o worker nunca precisa ler isso.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'prontuario_entradas' AND relkind = 'r') THEN
    EXECUTE 'REVOKE ALL ON prontuario_entradas FROM app_n8n';
  END IF;
END $$;

COMMIT;
