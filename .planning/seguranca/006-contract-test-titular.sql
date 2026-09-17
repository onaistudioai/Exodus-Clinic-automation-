-- 006-contract-test-titular.sql — prova executável dos direitos do titular.
--
-- Roda em branch/banco de teste. Cria dado, exercita as duas funções, e faz
-- ROLLBACK no fim: não deixa rastro. Qualquer asserção falsa aborta com EXCEPTION.
--
--   uso: psql "$DATABASE_URL_TESTE" -f 006-contract-test-titular.sql
--
-- Cobre as 6 afirmações que o módulo faz e que, se falsas, viram infração:
--   1. eliminação revoga o vínculo do WhatsApp;
--   2. eliminação registra opt-out com prova;
--   3. eliminação NÃO apaga prontuário dentro do prazo legal;
--   4. número compartilhado com outro paciente ativo NÃO é descadastrado;
--   5. expurgo por retenção não toca em quem ainda está no prazo;
--   6. expurgo por retenção desidentifica quando o prazo vence.
BEGIN;

DO $$
DECLARE
  v_clinica  INTEGER;
  v_usuario  INTEGER;
  v_pac      INTEGER;   -- titular que pede eliminação
  v_irmao    INTEGER;   -- outro paciente no MESMO número
  v_contato  INTEGER;
  v_recibo   JSONB;
  v_n        INTEGER;
  v_tem      BOOLEAN;
BEGIN
  -- ── cenário ───────────────────────────────────────────────────────────────
  INSERT INTO clinicas (nome) VALUES ('TESTE-titular') RETURNING id INTO v_clinica;
  PERFORM set_config('app.clinica_id', v_clinica::text, true);

  INSERT INTO usuarios (clinica_id, nome, papel)
  VALUES (v_clinica, 'Admin Teste', 'admin') RETURNING id INTO v_usuario;

  INSERT INTO pacientes (clinica_id, nome_completo, data_nascimento)
  VALUES (v_clinica, 'Titular Teste', '1990-01-01') RETURNING id INTO v_pac;

  INSERT INTO pacientes (clinica_id, nome_completo, data_nascimento)
  VALUES (v_clinica, 'Irmão Teste', '1992-01-01') RETURNING id INTO v_irmao;

  INSERT INTO contatos_whatsapp (clinica_id, chat_id, telefone, marketing_optin)
  VALUES (v_clinica, '5547999990000@c.us', '5547999990000', true)
  RETURNING id INTO v_contato;

  -- os DOIS pacientes compartilham o mesmo número (mãe/filho, caso real)
  INSERT INTO paciente_contato (clinica_id, paciente_id, contato_id, titular)
  VALUES (v_clinica, v_pac, v_contato, true),
         (v_clinica, v_irmao, v_contato, false);

  -- prontuário RECENTE: dentro dos 20 anos, não pode ser expurgado
  INSERT INTO prontuario_entradas
    (clinica_id, paciente_id, profissional_id, estado, texto_clinico,
     tipo_atendimento, precisa_retorno, finalizado_em)
  VALUES (v_clinica, v_pac, v_usuario, 'finalizado', 'texto clínico de teste',
          'consulta', false, NOW());

  -- ── (1) e (3) eliminação ──────────────────────────────────────────────────
  v_recibo := fn_titular_eliminar(v_pac, 'pedido de teste', v_usuario);

  SELECT count(*)::int INTO v_n
    FROM paciente_contato
   WHERE paciente_id = v_pac AND vinculo_status = 'revogado';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FALHA 1: vínculo do titular não foi revogado (n=%)', v_n;
  END IF;

  SELECT count(*)::int INTO v_n
    FROM prontuario_entradas
   WHERE paciente_id = v_pac AND expurgado = false AND texto_clinico IS NOT NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FALHA 3: prontuário dentro do prazo legal foi apagado — art. 16 I violado';
  END IF;

  IF (v_recibo->>'prontuarios_retidos')::int <> 1 THEN
    RAISE EXCEPTION 'FALHA 3b: recibo não informou o prontuário retido: %', v_recibo;
  END IF;

  -- ── (4) número compartilhado não é descadastrado ──────────────────────────
  SELECT marketing_optin INTO v_tem FROM contatos_whatsapp WHERE id = v_contato;
  IF v_tem IS NOT TRUE THEN
    RAISE EXCEPTION 'FALHA 4: opt-out atingiu número ainda vinculado a outro paciente ativo';
  END IF;
  IF (v_recibo->>'optouts_registrados')::int <> 0 THEN
    RAISE EXCEPTION 'FALHA 4b: recibo alegou opt-out que não deveria ocorrer: %', v_recibo;
  END IF;

  -- ── (2) agora o irmão sai de cena: o número fica só do titular ────────────
  UPDATE paciente_contato SET vinculo_status = 'revogado'
   WHERE paciente_id = v_irmao AND contato_id = v_contato;

  v_recibo := fn_titular_eliminar(v_pac, 'segundo pedido', v_usuario);

  SELECT marketing_optin INTO v_tem FROM contatos_whatsapp WHERE id = v_contato;
  IF v_tem IS NOT FALSE THEN
    RAISE EXCEPTION 'FALHA 2: opt-out não foi aplicado ao número exclusivo do titular';
  END IF;

  SELECT count(*)::int INTO v_n
    FROM consentimento_eventos
   WHERE contato_id = v_contato AND tipo = 'optout' AND evidencia IS NOT NULL;
  IF v_n < 1 THEN
    RAISE EXCEPTION 'FALHA 2b: opt-out sem prova em consentimento_eventos';
  END IF;

  IF (v_recibo->>'ja_havia_pedido')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FALHA 2c: segundo pedido não reconheceu o primeiro (data deve ser preservada)';
  END IF;

  -- ── (5) retenção não toca em quem está no prazo ───────────────────────────
  PERFORM fn_expurgo_retencao();
  -- a função zera o GUC no fim (fail-closed); sem reatribuir, as asserções
  -- seguintes leriam 0 linhas e "passariam" por engano.
  PERFORM set_config('app.clinica_id', v_clinica::text, true);

  SELECT anonimizado_em IS NULL INTO v_tem FROM pacientes WHERE id = v_pac;
  IF v_tem IS NOT TRUE THEN
    RAISE EXCEPTION 'FALHA 5: paciente com prontuário recente foi anonimizado antes do prazo';
  END IF;

  -- ── (6) envelhece o prontuário 21 anos e o expurgo passa a agir ───────────
  UPDATE prontuario_entradas
     SET criado_em = NOW() - interval '21 years', finalizado_em = NOW() - interval '21 years'
   WHERE paciente_id = v_pac;

  PERFORM fn_expurgo_retencao();
  -- a função zera o GUC no fim (fail-closed); sem reatribuir, as asserções
  -- seguintes leriam 0 linhas e "passariam" por engano.
  PERFORM set_config('app.clinica_id', v_clinica::text, true);

  SELECT (anonimizado_em IS NOT NULL AND cpf_hash IS NULL
          AND nome_completo LIKE 'TITULAR ELIMINADO%')
    INTO v_tem FROM pacientes WHERE id = v_pac;
  IF v_tem IS NOT TRUE THEN
    RAISE EXCEPTION 'FALHA 6: prazo vencido e o titular NÃO foi desidentificado';
  END IF;

  SELECT count(*)::int INTO v_n
    FROM prontuario_entradas
   WHERE paciente_id = v_pac AND (texto_clinico IS NOT NULL OR expurgado = false);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FALHA 6b: texto clínico sobreviveu ao expurgo de retenção (n=%)', v_n;
  END IF;

  RAISE NOTICE 'OK — 6/6 asserções de direitos do titular passaram.';
END $$;

-- Nada do cenário fica no banco.
ROLLBACK;
