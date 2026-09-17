-- ============================================================================
-- 003-contract-test.sql — isolamento cross-tenant de crm_tarefas.
-- Rodar como app_painel. Cria uma tarefa na clínica 2 e prova que a clínica 1
-- NÃO a enxerga. Limpa no fim. Requer um paciente existente na clínica 2.
-- ============================================================================

-- semear uma tarefa na Aurora (clínica 2), anexada ao 1º paciente dela
SET app.clinica_id = '2';
INSERT INTO crm_tarefas (clinica_id, paciente_id, titulo, descricao)
SELECT 2, p.id, '[contract-test] ligar para o paciente', 'apagar depois'
  FROM pacientes p
 WHERE p.clinica_id = 2 AND p.status = 'ativo'
 ORDER BY p.id
 LIMIT 1;

SELECT '2_ve_a_propria' AS caso, count(*) AS linhas
  FROM crm_tarefas WHERE titulo LIKE '[contract-test]%';   -- espera 1

-- clínica 1 não pode ver a tarefa da Aurora
SET app.clinica_id = '1';
SELECT '1_nao_ve_da_2' AS caso, count(*) AS linhas
  FROM crm_tarefas WHERE titulo LIKE '[contract-test]%';   -- espera 0

-- limpeza (de volta na clínica dona)
SET app.clinica_id = '2';
DELETE FROM crm_tarefas WHERE titulo LIKE '[contract-test]%';
RESET app.clinica_id;
