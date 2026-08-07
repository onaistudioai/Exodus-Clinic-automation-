-- ============================================================================
-- 005-contract-test-consentimento.sql — Contrato do opt-in/opt-out (LGPD).
-- Mesmo padrão de 003: auto-verificável (RAISE EXCEPTION), BEGIN..ROLLBACK,
-- nada persiste. Aplicar APÓS 004-consentimento.sql. Runner: _run-sql.mjs.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_contato INT; v_pac INT; v_camp INT; v_alvo INT;
  v_chat TEXT; v_n INT; v_erro BOOLEAN; v_mudou BOOLEAN;
  k_clinica CONSTANT TEXT := '2';   -- Bella
BEGIN
  PERFORM set_config('app.clinica_id', k_clinica, true);

  -- ----- setup: contato + paciente + vínculo + campanha + alvo ativo -----
  INSERT INTO contatos_whatsapp (clinica_id, chat_id, telefone)
  VALUES (k_clinica::int, '55TESTE000@c.us', '55TESTE000')
  RETURNING id, chat_id INTO v_contato, v_chat;

  SELECT id INTO v_pac FROM pacientes WHERE clinica_id = k_clinica::int LIMIT 1;
  IF v_pac IS NULL THEN
    RAISE EXCEPTION 'CONTRATO: clínica % sem paciente — impossível testar.', k_clinica;
  END IF;
  INSERT INTO paciente_contato (clinica_id, paciente_id, contato_id, titular)
  VALUES (k_clinica::int, v_pac, v_contato, true);

  INSERT INTO reativacao_campanhas (clinica_id, nome, janela_dias, passos, ativa)
  VALUES (k_clinica::int, '[TESTE] consent', 30,
          '[{"offset_dias":0,"template":"oi"}]'::jsonb, false)
  RETURNING id INTO v_camp;
  INSERT INTO reativacao_alvos (clinica_id, campanha_id, paciente_id, contato_id, status)
  VALUES (k_clinica::int, v_camp, v_pac, v_contato, 'ativo')
  RETURNING id INTO v_alvo;

  -- ===== 1) FAIL-CLOSED: contato sem opt-in (NULL) não aparece na view =====
  SELECT count(*) INTO v_n FROM v_reativacao_inativos WHERE contato_id = v_contato;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FALHA 1: contato sem opt-in (NULL) apareceu como elegível';
  END IF;

  -- ===== 2) opt-in grava estado + prova =====
  v_mudou := registrar_consentimento(v_chat, 'optin', 'ficha_presencial', 'teste');
  IF NOT v_mudou THEN RAISE EXCEPTION 'FALHA 2a: opt-in deveria mudar o estado'; END IF;
  SELECT count(*) INTO v_n FROM consentimento_eventos
   WHERE contato_id = v_contato AND tipo = 'optin';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHA 2b: evento de opt-in não registrado'; END IF;
  IF (SELECT marketing_optin FROM contatos_whatsapp WHERE id = v_contato) IS NOT TRUE THEN
    RAISE EXCEPTION 'FALHA 2c: estado corrente não virou TRUE';
  END IF;

  -- ===== 3) opt-out encerra a sequência de reativação em curso =====
  PERFORM registrar_consentimento(v_chat, 'optout', 'whatsapp_sair', 'SAIR');
  IF (SELECT status FROM reativacao_alvos WHERE id = v_alvo) <> 'optout' THEN
    RAISE EXCEPTION 'FALHA 3: opt-out não encerrou o alvo ativo — worker continuaria enviando';
  END IF;

  -- ===== 4) opt-out é porta de mão única: reimportar CSV não ressuscita =====
  v_mudou := registrar_consentimento(v_chat, 'optin', 'importacao_csv', 'planilha do cliente');
  IF v_mudou THEN RAISE EXCEPTION 'FALHA 4a: opt-in sobrescreveu um opt-out'; END IF;
  IF (SELECT marketing_optin FROM contatos_whatsapp WHERE id = v_contato) IS NOT FALSE THEN
    RAISE EXCEPTION 'FALHA 4b: estado deixou de ser opt-out';
  END IF;
  -- e a tentativa recusada não polui o livro-razão
  SELECT count(*) INTO v_n FROM consentimento_eventos WHERE contato_id = v_contato;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FALHA 4c: esperado 2 eventos, achou %', v_n; END IF;

  -- ===== 5) livro-razão append-only =====
  v_erro := false;
  BEGIN UPDATE consentimento_eventos SET origem='x' WHERE contato_id = v_contato;
  EXCEPTION WHEN others THEN v_erro := true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'FALHA 5a: UPDATE em consentimento_eventos deveria ser proibido'; END IF;
  v_erro := false;
  BEGIN DELETE FROM consentimento_eventos WHERE contato_id = v_contato;
  EXCEPTION WHEN others THEN v_erro := true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'FALHA 5b: DELETE em consentimento_eventos deveria ser proibido'; END IF;

  -- ===== 6) isolamento cross-tenant: outra clínica não vê nem escreve =====
  PERFORM set_config('app.clinica_id', '999999', true);
  SELECT count(*) INTO v_n FROM consentimento_eventos WHERE contato_id = v_contato;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHA 6a: RLS vazou consentimento entre clínicas'; END IF;
  v_erro := false;
  BEGIN PERFORM registrar_consentimento(v_chat, 'optin', 'painel', 'cross-tenant');
  EXCEPTION WHEN others THEN v_erro := true; END;
  IF NOT v_erro THEN RAISE EXCEPTION 'FALHA 6b: outra clínica conseguiu mexer no consentimento'; END IF;

  -- ===== 7) fail-closed sem GUC =====
  PERFORM set_config('app.clinica_id', '', true);
  SELECT count(*) INTO v_n FROM consentimento_eventos;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHA 7: sem GUC deveria retornar 0 linhas'; END IF;

  RAISE NOTICE 'CONTRATO CONSENTIMENTO: 7/7 OK';
END$$;

ROLLBACK;
