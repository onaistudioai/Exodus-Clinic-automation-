-- ============================================================================
-- 002-prove-rls.sql — prova de isolamento da crm_tarefas (rodar como app_painel).
-- Espera-se: com GUC setado, vê só a clínica; sem GUC, 0 linhas (fail-closed).
-- ============================================================================

-- clínica 2 (Bella) enxerga só o que é dela
SET app.clinica_id = '2';
SELECT 'com_guc_bella' AS caso, count(*) AS linhas FROM crm_tarefas;

-- sem GUC => policy compara com NULL => 0 linhas (fail-closed)
RESET app.clinica_id;
SELECT 'sem_guc' AS caso, count(*) AS linhas FROM crm_tarefas;  -- espera 0

-- tentar gravar em outra clínica com o GUC da Bella deve falhar no WITH CHECK
SET app.clinica_id = '2';
DO $$
BEGIN
  INSERT INTO crm_tarefas (clinica_id, paciente_id, titulo)
  VALUES (1, 1, 'cross-tenant proibido');
  RAISE EXCEPTION 'FALHA: WITH CHECK deixou gravar cross-tenant';
EXCEPTION WHEN check_violation OR insufficient_privilege THEN
  RAISE NOTICE 'OK: WITH CHECK bloqueou cross-tenant';
END $$;
RESET app.clinica_id;
