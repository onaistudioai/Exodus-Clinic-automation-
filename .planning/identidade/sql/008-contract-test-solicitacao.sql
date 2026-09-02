-- 008-contract-test-solicitacao.sql — prova o essencial de
-- 007-solicitacao-paciente.sql (dívida declarada: teste de integração TS do
-- executor fica pendente, por pedido explícito da sessão par para Fase 3/4).
BEGIN;

DO $$
DECLARE
  v_clinica int;
  v_id1 bigint;
  v_id2 bigint;
BEGIN
  SELECT id INTO v_clinica FROM clinicas ORDER BY id LIMIT 1;
  PERFORM set_config('app.clinica_id', v_clinica::text, true);

  -- (1) anti-flood por (chat_id, motivo): idempotente igual a abrir_escalonamento.
  v_id1 := abrir_solicitacao_paciente('+5511900000094-teste-solic@c.us', NULL,
             'nivel_insuficiente', 'ver_proximos_agendamentos', '{}'::jsonb);
  v_id2 := abrir_solicitacao_paciente('+5511900000094-teste-solic@c.us', NULL,
             'nivel_insuficiente', 'ver_proximos_agendamentos', '{}'::jsonb);
  IF v_id1 <> v_id2 THEN
    RAISE EXCEPTION 'FALHA(1): segunda chamada deveria reusar o pedido aberto, criou outro.';
  END IF;

  -- motivo DIFERENTE no MESMO chat abre um segundo pedido — não é o mesmo dedupe key.
  v_id2 := abrir_solicitacao_paciente('+5511900000094-teste-solic@c.us', NULL,
             'menor_sem_autoatendimento', 'autoatendimento_generico', '{}'::jsonb);
  IF v_id2 = v_id1 THEN
    RAISE EXCEPTION 'FALHA(1b): motivo diferente deveria abrir pedido diferente.';
  END IF;
  RAISE NOTICE 'OK(1): anti-flood por (chat_id, motivo), não só por chat_id.';

  -- (2) transição inválida é recusada pela MESMA função de estado_agendamento... não,
  -- de solicitacao_aprovacao (fn_transicao_solicitacao_valida), reusada aqui.
  BEGIN
    UPDATE solicitacao_paciente
       SET estado = 'aprovada', decidido_por = (SELECT id FROM usuarios LIMIT 1), decidido_em = now()
     WHERE id = v_id1;
    UPDATE solicitacao_paciente SET estado = 'negada' WHERE id = v_id1; -- aprovada -> negada não existe
    RAISE EXCEPTION 'FALHA(2): transição aprovada->negada deveria ter sido recusada.';
  EXCEPTION WHEN check_violation THEN
    NULL; -- esperado, do trigger reusado de solicitacao_aprovacao
  END;
  RAISE NOTICE 'OK(2): trigger reusado (fn_transicao_solicitacao_valida) recusa transição inválida aqui também.';

  -- (3) coerência de decisão: não dá para marcar aprovada sem decidido_por/em (CHECK).
  BEGIN
    INSERT INTO solicitacao_paciente
      (clinica_id, chat_id, motivo, acao_pretendida, estado)
    VALUES (v_clinica, '+5511900000093-teste-solic@c.us', 'nivel_insuficiente', 'x', 'aprovada');
    RAISE EXCEPTION 'FALHA(3): INSERT direto em aprovada sem decidido_por/em deveria falhar.';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  RAISE NOTICE 'OK(3): chk_decisao_coerente_paciente recusa estado terminal sem decisor.';
END $$;

ROLLBACK;
