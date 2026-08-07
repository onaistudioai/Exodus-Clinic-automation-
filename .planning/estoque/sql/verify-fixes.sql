-- Verifica se as correções 004 estão aplicadas em prod.
SELECT
  EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_reconciliacao_estoque') AS view_reconciliacao,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_lote_sentinela_divergencia') AS idx_sentinela,
  (SELECT reloptions::text FROM pg_class WHERE relname = 'v_reconciliacao_estoque') AS view_opts,
  (SELECT count(*) FROM information_schema.role_table_grants
     WHERE table_name = 'v_reconciliacao_estoque' AND grantee = 'app_painel') AS grant_app_painel;
