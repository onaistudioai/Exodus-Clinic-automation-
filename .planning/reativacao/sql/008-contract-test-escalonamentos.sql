-- ============================================================================
-- 008-contract-test-escalonamentos.sql — Contrato da fila de encaminhamento.
-- Padrão de 003/005: auto-verificável, BEGIN..ROLLBACK, nada persiste.
-- Aplicar APÓS 007-escalonamentos.sql. Runner: _run-sql.mjs.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_id1 BIGINT; v_id2 BIGINT; v_id3 BIGINT; v_n INT; v_erro BOOLEAN;
  k_clinica CONSTANT TEXT := '2';   -- Aurora
  k_chat    CONSTANT TEXT := '55TESTE777@c.us';
BEGIN
  PERFORM set_config('app.clinica_id', k_clinica, true);

  -- ===== 1) abre chamado para número não cadastrado (não pode falhar) =====
  v_id1 := abrir_escalonamento(k_chat, 'sintoma_clinico', 'estou com dor no dente');
  IF v_id1 IS NULL THEN
    RAISE EXCEPTION 'FALHA 1: não abriu escalonamento para número não cadastrado';
  END IF;

  -- ===== 2) idempotência por chat: 2ª mensagem não cria chamado novo =====
  v_id2 := abrir_escalonamento(k_chat, 'sintoma_clinico', 'ainda está doendo');
  IF v_id2 <> v_id1 THEN
    RAISE EXCEPTION 'FALHA 2: chat com item aberto gerou chamado duplicado (% vs %)', v_id1, v_id2;
  END IF;
  SELECT count(*) INTO v_n FROM escalonamentos WHERE chat_id = k_chat;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHA 2b: esperado 1 chamado, achou %', v_n; END IF;

  -- ===== 3) resolvido libera nova abertura (paciente pode voltar a precisar) =====
  UPDATE escalonamentos SET status = 'resolvido', resolvido_em = NOW() WHERE id = v_id1;
  v_id3 := abrir_escalonamento(k_chat, 'pediu_humano', 'quero falar com alguém');
  IF v_id3 = v_id1 THEN
    RAISE EXCEPTION 'FALHA 3: após resolver, novo gatilho deveria abrir chamado novo';
  END IF;

  -- ===== 4) gatilho fora da lista é rejeitado (CHECK) =====
  v_erro := false;
  BEGIN
    INSERT INTO escalonamentos (clinica_id, chat_id, gatilho)
    VALUES (k_clinica::int, '55TESTE778@c.us', 'achismo_do_bot');
  EXCEPTION WHEN others THEN v_erro := true; END;
  IF NOT v_erro THEN
    RAISE EXCEPTION 'FALHA 4: gatilho fora dos 7 do Anexo I §5 deveria violar o CHECK';
  END IF;

  -- ===== 5) isolamento cross-tenant =====
  PERFORM set_config('app.clinica_id', '999999', true);
  SELECT count(*) INTO v_n FROM escalonamentos WHERE chat_id = k_chat;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHA 5a: RLS vazou fila entre clínicas'; END IF;
  -- outra clínica abrindo o mesmo chat cria item DELA, não enxerga o alheio
  v_erro := false;
  BEGIN
    PERFORM abrir_escalonamento(k_chat, 'pediu_humano', 'cross-tenant');
  EXCEPTION WHEN others THEN v_erro := true; END;
  IF NOT v_erro THEN
    SELECT count(*) INTO v_n FROM escalonamentos WHERE chat_id = k_chat;
    IF v_n <> 1 THEN RAISE EXCEPTION 'FALHA 5b: contagem inesperada no tenant vizinho: %', v_n; END IF;
  END IF;

  -- ===== 6) fail-closed sem GUC =====
  PERFORM set_config('app.clinica_id', '', true);
  SELECT count(*) INTO v_n FROM escalonamentos;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHA 6: sem GUC deveria retornar 0 linhas'; END IF;

  RAISE NOTICE 'CONTRATO ESCALONAMENTOS: 6/6 OK';
END$$;

ROLLBACK;
