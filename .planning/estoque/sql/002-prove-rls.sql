-- 002-prove-rls.sql — prova ESTRUTURAL de RLS após aplicar 001.
-- Esperado: 4 linhas, todas com rls_on = t e rls_forced = t.
-- (Prova FUNCIONAL fail-closed com dados vai junto do seed na Fase 4/QA.)
SELECT relname,
       relrowsecurity      AS rls_on,
       relforcerowsecurity AS rls_forced,
       (SELECT count(*) FROM pg_policy WHERE polrelid = c.oid AND polname = 'rls_tenant') AS tem_policy
  FROM pg_class c
 WHERE relname IN ('produtos','lotes','movimentacoes_estoque','procedimento_materiais')
   AND relkind = 'r'
 ORDER BY relname;
