-- pront-fns.sql — corpos das funções/triggers do prontuário (p/ escrever o contrato).
SELECT
  pg_get_functiondef('trg_pront_append_only'::regproc)        AS append_only,
  pg_get_functiondef('trg_pront_finaliza_consulta'::regproc)  AS finaliza,
  pg_get_functiondef('fn_e_menor'::regproc)                   AS e_menor,
  pg_get_functiondef('fn_login_lookup'::regproc)              AS login_lookup;
