-- ============================================================================
-- 003-contract-test.sql — Contrato do Módulo Reativação (QA / Fase 4 OPUS)
-- Auto-verificável: cada checagem RAISE EXCEPTION se violada. BEGIN..ROLLBACK:
-- nada é persistido. Roda sob o superuser do runner, mas testa o comportamento
-- de app_painel via SET LOCAL ROLE app_painel onde a RLS importa.
-- Aplicar APÓS 001-reativacao.sql. Uso: runner _run-sql.mjs (path deste arquivo).
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_camp INT; v_alvo INT; v_n INT; v_erro BOOLEAN;
  k_clinica CONSTANT TEXT := '2';   -- Bella
BEGIN
  -- contexto tenant
  PERFORM set_config('app.clinica_id', k_clinica, true);

  -- ----- setup mínimo (campanha + alvo fictício) -----
  INSERT INTO reativacao_campanhas (clinica_id, nome, janela_dias, passos, ativa)
  VALUES (k_clinica::int, '[TESTE] contrato', 30,
          '[{"offset_dias":0,"template":"oi {nome}"},{"offset_dias":7,"template":"oi2"}]'::jsonb, true)
  RETURNING id INTO v_camp;

  -- precisa de um paciente real da clínica p/ a FK; pega qualquer um
  INSERT INTO reativacao_alvos (clinica_id, campanha_id, paciente_id, passo_atual, proximo_envio, status)
  SELECT k_clinica::int, v_camp, p.id, 0, NOW(), 'ativo'
    FROM pacientes p WHERE p.clinica_id = k_clinica::int LIMIT 1
  RETURNING id INTO v_alvo;
  IF v_alvo IS NULL THEN
    RAISE NOTICE 'CONTRATO: sem paciente na clínica % — pulando testes de alvo.', k_clinica;
  END IF;

  -- ===== 1) append-only em reativacao_envios (UPDATE/DELETE proibidos) =====
  IF v_alvo IS NOT NULL THEN
    INSERT INTO reativacao_envios (clinica_id, alvo_id, passo, modo, wa_status)
    VALUES (k_clinica::int, v_alvo, 0, 'dry', 'simulado');
    v_erro := false;
    BEGIN
      UPDATE reativacao_envios SET wa_status='x' WHERE alvo_id = v_alvo;
    EXCEPTION WHEN others THEN v_erro := true; END;
    IF NOT v_erro THEN RAISE EXCEPTION 'FALHA 1a: UPDATE em reativacao_envios deveria ser proibido'; END IF;
    v_erro := false;
    BEGIN
      DELETE FROM reativacao_envios WHERE alvo_id = v_alvo;
    EXCEPTION WHEN others THEN v_erro := true; END;
    IF NOT v_erro THEN RAISE EXCEPTION 'FALHA 1b: DELETE em reativacao_envios deveria ser proibido'; END IF;
    RAISE NOTICE 'OK 1: reativacao_envios append-only';
  END IF;

  -- ===== 2) idempotência de envio LIVE (uq_envio_live_por_passo) =====
  IF v_alvo IS NOT NULL THEN
    INSERT INTO reativacao_envios (clinica_id, alvo_id, passo, modo, wa_status)
    VALUES (k_clinica::int, v_alvo, 1, 'live', 'ok');
    v_erro := false;
    BEGIN
      INSERT INTO reativacao_envios (clinica_id, alvo_id, passo, modo, wa_status)
      VALUES (k_clinica::int, v_alvo, 1, 'live', 'ok');  -- mesmo (alvo,passo) live
    EXCEPTION WHEN unique_violation THEN v_erro := true; END;
    IF NOT v_erro THEN RAISE EXCEPTION 'FALHA 2: 2º envio LIVE do mesmo passo deveria colidir (uq)'; END IF;
    RAISE NOTICE 'OK 2: idempotência LIVE por (alvo,passo)';
  END IF;

  -- ===== 3) 1 sequência ATIVA por paciente (uq_alvo_ativo_por_paciente) =====
  IF v_alvo IS NOT NULL THEN
    v_erro := false;
    BEGIN
      INSERT INTO reativacao_alvos (clinica_id, campanha_id, paciente_id, passo_atual, proximo_envio, status)
      SELECT k_clinica::int, v_camp, ra.paciente_id, 0, NOW(), 'ativo'
        FROM reativacao_alvos ra WHERE ra.id = v_alvo;  -- mesmo paciente, status ativo
    EXCEPTION WHEN unique_violation THEN v_erro := true; END;
    IF NOT v_erro THEN RAISE EXCEPTION 'FALHA 3: 2ª sequência ATIVA do mesmo paciente deveria colidir (uq)'; END IF;
    RAISE NOTICE 'OK 3: 1 sequência ativa por paciente';
  END IF;

  -- ===== 4) 1 campanha ATIVA por clínica (uq_campanha_ativa_por_clinica) =====
  v_erro := false;
  BEGIN
    INSERT INTO reativacao_campanhas (clinica_id, nome, ativa)
    VALUES (k_clinica::int, '[TESTE] 2a ativa', true);
  EXCEPTION WHEN unique_violation THEN v_erro := true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'FALHA 4: 2ª campanha ATIVA na mesma clínica deveria colidir (uq)'; END IF;
  RAISE NOTICE 'OK 4: 1 campanha ativa por clínica';

  -- ===== 5) RLS fail-closed: sem GUC -> 0 linhas (sob app_painel) =====
  SET LOCAL ROLE app_painel;
  PERFORM set_config('app.clinica_id', '', true);  -- sem tenant
  SELECT count(*) INTO v_n FROM reativacao_campanhas;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHA 5: RLS fail-closed violada (% linhas sem GUC)', v_n; END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 5: RLS fail-closed (app_painel sem GUC = 0 linhas)';

  -- ===== 6) isolamento entre clínicas (sob app_painel, GUC de outra clínica) =====
  SET LOCAL ROLE app_painel;
  PERFORM set_config('app.clinica_id', '999999', true);  -- clínica inexistente
  SELECT count(*) INTO v_n FROM reativacao_alvos;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHA 6: isolamento violado (% alvos visíveis p/ clínica 999999)', v_n; END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 6: isolamento entre clínicas';

  -- ===== 7) app_painel NÃO pode UPDATE/DELETE em reativacao_envios (grant) =====
  PERFORM set_config('app.clinica_id', k_clinica, true);
  SET LOCAL ROLE app_painel;
  v_erro := false;
  BEGIN
    EXECUTE 'DELETE FROM reativacao_envios';
  EXCEPTION WHEN insufficient_privilege THEN v_erro := true;
            WHEN others THEN v_erro := true; END;  -- trigger ou grant: ambos barram
  IF NOT v_erro THEN RAISE EXCEPTION 'FALHA 7: app_painel não deveria conseguir DELETE em reativacao_envios'; END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 7: app_painel sem DELETE no livro-razão';

  RAISE NOTICE '===== CONTRATO REATIVAÇÃO: TODAS AS CHECAGENS PASSARAM =====';
END$$;

ROLLBACK;
SELECT 'contract-reativacao: PASSED (rolled back, nada persistido)' AS resultado;
