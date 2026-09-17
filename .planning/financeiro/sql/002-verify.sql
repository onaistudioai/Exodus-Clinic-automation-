-- Verificação P1 (Wave 1) — tabelas, RLS FORCE, grants, append-only, anti-dup.
SELECT 'tabela' AS chk, c.relname AS obj,
       (c.relrowsecurity AND c.relforcerowsecurity)::text AS ok
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN
       ('financeiro_precos','financeiro_cobrancas','financeiro_lancamentos')
UNION ALL
SELECT 'grant_lancamentos' AS chk, privilege_type AS obj, 'app_painel' AS ok
  FROM information_schema.role_table_grants
 WHERE table_name='financeiro_lancamentos' AND grantee='app_painel'
UNION ALL
SELECT 'indice' AS chk, indexname AS obj, '' AS ok
  FROM pg_indexes
 WHERE tablename IN ('financeiro_cobrancas','financeiro_lancamentos')
   AND indexname LIKE 'uq_%'
UNION ALL
SELECT 'clinicas.cnpj' AS chk, column_name AS obj, data_type AS ok
  FROM information_schema.columns WHERE table_name='clinicas' AND column_name='cnpj'
ORDER BY chk, obj;
