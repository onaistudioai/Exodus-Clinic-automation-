-- ============================================================================
-- 003-contract-test.sql — Contrato do Módulo Financeiro (QA / Fase 4 OPUS)
-- Auto-verificável: cada checagem RAISE EXCEPTION se violada. BEGIN..ROLLBACK:
-- nada é persistido. Testa o comportamento de app_painel via SET LOCAL ROLE onde
-- a RLS/grant importam. Aplicar APÓS 001-financeiro.sql. Uso: runner _run-sql.mjs.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_pac INT; v_ent INT; v_cob INT; v_n INT; v_erro BOOLEAN;
  k_clinica CONSTANT TEXT := '2';   -- Aurora
BEGIN
  PERFORM set_config('app.clinica_id', k_clinica, true);

  -- paciente + entrada de prontuário reais da clínica (FKs)
  SELECT id INTO v_pac FROM pacientes WHERE clinica_id = k_clinica::int LIMIT 1;
  IF v_pac IS NULL THEN
    RAISE NOTICE 'CONTRATO: sem paciente na clínica % — pulando.', k_clinica; RETURN;
  END IF;
  SELECT id INTO v_ent FROM prontuario_entradas
    WHERE clinica_id = k_clinica::int ORDER BY id DESC LIMIT 1;

  -- preço de teste p/ exercitar cobrança
  INSERT INTO financeiro_precos (clinica_id, tipo_atendimento, valor, ativo)
  VALUES (k_clinica::int, 'consulta', 200.00, true)
  ON CONFLICT (clinica_id, tipo_atendimento) DO UPDATE SET valor = 200.00, ativo = true;

  -- ===== 1) anti-duplicata da cobrança por entrada (uq_cobranca_por_entrada) =====
  IF v_ent IS NOT NULL THEN
    INSERT INTO financeiro_cobrancas
      (clinica_id, paciente_id, entrada_prontuario_id, tipo_atendimento, valor, status)
    VALUES (k_clinica::int, v_pac, v_ent, 'consulta', 200.00, 'aberta')
    RETURNING id INTO v_cob;
    v_erro := false;
    BEGIN
      INSERT INTO financeiro_cobrancas
        (clinica_id, paciente_id, entrada_prontuario_id, tipo_atendimento, valor, status)
      VALUES (k_clinica::int, v_pac, v_ent, 'consulta', 200.00, 'aberta');  -- mesma entrada
    EXCEPTION WHEN unique_violation THEN v_erro := true; END;
    IF NOT v_erro THEN RAISE EXCEPTION 'FALHA 1: 2ª cobrança da mesma entrada deveria colidir (uq)'; END IF;
    RAISE NOTICE 'OK 1: anti-duplicata da cobrança por entrada';
  ELSE
    -- sem entrada: cria cobrança avulsa só p/ os testes seguintes
    INSERT INTO financeiro_cobrancas (clinica_id, paciente_id, tipo_atendimento, valor, status)
    VALUES (k_clinica::int, v_pac, 'consulta', 200.00, 'aberta') RETURNING id INTO v_cob;
    RAISE NOTICE 'OK 1: (sem entrada de prontuário — anti-dup por entrada não exercitada)';
  END IF;

  -- ===== 2) idempotência do pagamento (uq_lancamento_por_cobranca) =====
  INSERT INTO financeiro_lancamentos (clinica_id, tipo, valor, cobranca_id, forma_pagamento)
  VALUES (k_clinica::int, 'receita', 200.00, v_cob, 'pix');
  v_erro := false;
  BEGIN
    INSERT INTO financeiro_lancamentos (clinica_id, tipo, valor, cobranca_id, forma_pagamento)
    VALUES (k_clinica::int, 'receita', 200.00, v_cob, 'pix');  -- 2ª receita p/ mesma cobrança
  EXCEPTION WHEN unique_violation THEN v_erro := true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'FALHA 2: 2º pagamento da mesma cobrança deveria colidir (uq)'; END IF;
  RAISE NOTICE 'OK 2: idempotência do pagamento por cobrança';

  -- ===== 3) append-only em financeiro_lancamentos (UPDATE/DELETE proibidos) =====
  v_erro := false;
  BEGIN UPDATE financeiro_lancamentos SET valor = 1 WHERE cobranca_id = v_cob;
  EXCEPTION WHEN others THEN v_erro := true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'FALHA 3a: UPDATE em financeiro_lancamentos deveria ser proibido'; END IF;
  v_erro := false;
  BEGIN DELETE FROM financeiro_lancamentos WHERE cobranca_id = v_cob;
  EXCEPTION WHEN others THEN v_erro := true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'FALHA 3b: DELETE em financeiro_lancamentos deveria ser proibido'; END IF;
  RAISE NOTICE 'OK 3: financeiro_lancamentos append-only';

  -- ===== 4) CHECK valor de lançamento > 0 =====
  v_erro := false;
  BEGIN
    INSERT INTO financeiro_lancamentos (clinica_id, tipo, valor) VALUES (k_clinica::int, 'despesa', 0);
  EXCEPTION WHEN check_violation THEN v_erro := true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'FALHA 4: lançamento com valor 0 deveria violar CHECK'; END IF;
  RAISE NOTICE 'OK 4: CHECK valor de lançamento > 0';

  -- ===== 5) RLS fail-closed: sem GUC -> 0 linhas (sob app_painel) =====
  SET LOCAL ROLE app_painel;
  PERFORM set_config('app.clinica_id', '', true);
  SELECT count(*) INTO v_n FROM financeiro_cobrancas;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHA 5: RLS fail-closed violada (% linhas sem GUC)', v_n; END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 5: RLS fail-closed (app_painel sem GUC = 0 linhas)';

  -- ===== 6) isolamento entre clínicas (GUC de outra clínica) =====
  SET LOCAL ROLE app_painel;
  PERFORM set_config('app.clinica_id', '999999', true);
  SELECT count(*) INTO v_n FROM financeiro_cobrancas;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHA 6: isolamento violado (% cobranças visíveis p/ clínica 999999)', v_n; END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 6: isolamento entre clínicas';

  -- ===== 7) app_painel NÃO pode UPDATE/DELETE em financeiro_lancamentos (grant) =====
  PERFORM set_config('app.clinica_id', k_clinica, true);
  SET LOCAL ROLE app_painel;
  v_erro := false;
  BEGIN EXECUTE 'DELETE FROM financeiro_lancamentos';
  EXCEPTION WHEN insufficient_privilege THEN v_erro := true; WHEN others THEN v_erro := true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'FALHA 7: app_painel não deveria conseguir DELETE em financeiro_lancamentos'; END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 7: app_painel sem DELETE no livro-razão';

  -- ===== 8) WITH CHECK da RLS barra INSERT cross-tenant (sob app_painel) =====
  SET LOCAL ROLE app_painel;
  PERFORM set_config('app.clinica_id', k_clinica, true);
  v_erro := false;
  BEGIN
    -- tenta gravar lançamento com clinica_id de OUTRA clínica: WITH CHECK deve barrar
    INSERT INTO financeiro_lancamentos (clinica_id, tipo, valor) VALUES (999999, 'receita', 10);
  EXCEPTION WHEN others THEN v_erro := true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'FALHA 8: INSERT cross-tenant deveria ser barrado pelo WITH CHECK'; END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 8: WITH CHECK barra INSERT cross-tenant';

  RAISE NOTICE '===== CONTRATO FINANCEIRO: TODAS AS CHECAGENS PASSARAM =====';
END$$;

ROLLBACK;
SELECT 'contract-financeiro: PASSED (rolled back, nada persistido)' AS resultado;
