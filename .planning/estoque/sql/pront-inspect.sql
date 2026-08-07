-- pront-inspect.sql — introspecção do schema VIVO do prontuário (p/ escrever o contrato).
SELECT
  (SELECT json_agg(column_name ORDER BY ordinal_position)
     FROM information_schema.columns WHERE table_name = 'prontuario_entradas') AS cols_entradas,
  (SELECT json_agg(column_name ORDER BY ordinal_position)
     FROM information_schema.columns WHERE table_name = 'prontuario_acessos') AS cols_acessos,
  (SELECT json_agg(json_build_object('trigger', tgname, 'fn', p.proname, 'enabled', tgenabled))
     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE c.relname = 'prontuario_entradas' AND NOT t.tgisinternal) AS triggers_entradas,
  (SELECT json_agg(json_build_object('name', conname, 'def', pg_get_constraintdef(oid)))
     FROM pg_constraint WHERE conrelid = 'prontuario_entradas'::regclass AND contype = 'c') AS checks_entradas,
  (SELECT json_agg(json_build_object('tbl', relname, 'rls', relrowsecurity, 'forced', relforcerowsecurity))
     FROM pg_class WHERE relname IN ('prontuario_entradas', 'prontuario_acessos') AND relkind = 'r') AS rls,
  (SELECT json_agg(json_build_object('fn', proname, 'secdef', prosecdef))
     FROM pg_proc WHERE proname IN ('fn_login_lookup', 'fn_e_menor')) AS funcs,
  (SELECT json_agg(DISTINCT privilege_type)
     FROM information_schema.role_table_grants
    WHERE table_name = 'prontuario_entradas' AND grantee = 'app_painel') AS grants_entradas,
  (SELECT to_regclass('public.vw_consultas_sem_desfecho')::text) AS view_desfecho;
