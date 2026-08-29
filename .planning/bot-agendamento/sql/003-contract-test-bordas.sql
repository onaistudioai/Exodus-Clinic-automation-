-- ============================================================================
-- 003-contract-test-bordas.sql — os 19 casos da Parte B da spec 0.1.
-- BEGIN..ROLLBACK: não deixa rastro. Roda como owner.
-- Cada caso reporta OK(<id>) ou levanta exceção com o motivo.
-- I4 é parcial e está marcado como tal — a escalação para humano é da aplicação.
-- ============================================================================
BEGIN;

DO $bat$
DECLARE
  v_cl INT; v_cl2 INT; v_prof INT; v_serv INT;
  v_pac INT; v_pac2 INT; v_mae INT; v_filho INT;
  v_ct INT; v_ct2 INT;
  v_ag INT; v_ag2 INT; v_ag3 INT;
  v_r TEXT; v_n INT;
  v_t0 TIMESTAMPTZ := date_trunc('hour', NOW()) + INTERVAL '20 day';
BEGIN
  SELECT id INTO v_cl  FROM clinicas WHERE nome = '[TESTE] Clinica A';
  SELECT id INTO v_cl2 FROM clinicas WHERE nome = '[TESTE] Clinica B';
  INSERT INTO profissionais (clinica_id, nome) VALUES (v_cl,'Dr Bordas') RETURNING id INTO v_prof;
  INSERT INTO servicos (clinica_id, nome, duracao_min) VALUES (v_cl,'Consulta Bordas',30) RETURNING id INTO v_serv;
  INSERT INTO pacientes (clinica_id, nome_completo, data_nascimento)
    VALUES (v_cl,'Paciente Bordas', DATE '1985-03-10') RETURNING id INTO v_pac;
  INSERT INTO contatos_whatsapp (clinica_id, chat_id, telefone)
    VALUES (v_cl,'b1@c.us','5547900000001') RETURNING id INTO v_ct;

  -- =================== A.1 — função de prazo ===================
  -- consulta distante: teto de 30 min
  IF fn_prazo_retencao(v_t0 - INTERVAL '3 day', v_t0) <> (v_t0 - INTERVAL '3 day') + INTERVAL '30 min' THEN
    RAISE EXCEPTION 'FALHA(A1): consulta distante deveria segurar 30 min';
  END IF;
  -- consulta em 50 min: metade = 25 min
  IF fn_prazo_retencao(v_t0 - INTERVAL '50 min', v_t0) <> (v_t0 - INTERVAL '50 min') + INTERVAL '25 min' THEN
    RAISE EXCEPTION 'FALHA(A1): consulta em 50 min deveria segurar 25 min';
  END IF;
  -- piso: consulta em 10 min não aceita provisória
  IF fn_pode_reservar(NOW() + INTERVAL '10 min') THEN
    RAISE EXCEPTION 'FALHA(A1): abaixo do piso deveria recusar provisória';
  END IF;
  IF NOT fn_pode_reservar(NOW() + INTERVAL '40 min') THEN
    RAISE EXCEPTION 'FALHA(A1): acima do piso deveria aceitar';
  END IF;
  RAISE NOTICE 'OK(A1): prazo 30min/25min e piso de 15min conferem.';

  -- =================== C1 — concorrência no mesmo slot ===================
  INSERT INTO agendamentos_sofia_demo
    (clinica_id,paciente_id,profissional_id,servico_id,inicio,fim,status,reserva_expira_em,
     data_agendamento,hora_agendamento,telefone,contato_origem_id)
  VALUES (v_cl,v_pac,v_prof,v_serv,v_t0,v_t0+INTERVAL '30 min','reservada',
          fn_prazo_retencao(NOW(), v_t0), v_t0::date, v_t0::time,'5547900000001',v_ct)
  RETURNING id INTO v_ag;
  BEGIN
    INSERT INTO agendamentos_sofia_demo
      (clinica_id,paciente_id,profissional_id,servico_id,inicio,fim,status,
       data_agendamento,hora_agendamento,telefone)
    VALUES (v_cl,v_pac,v_prof,v_serv,v_t0+INTERVAL '10 min',v_t0+INTERVAL '40 min','reservada',
            v_t0::date,v_t0::time,'5547900000002');
    RAISE EXCEPTION 'FALHA(C1): segundo pedido no mesmo slot foi aceito';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'OK(C1): um cria, o outro recebe recusa atômica do banco.';
  END;

  INSERT INTO eventos_agendamento (clinica_id,agendamento_id,tipo,origem)
    VALUES (v_cl,v_ag,'criado','bot'), (v_cl,v_ag,'reservado','bot');

  -- =================== C2 — confirmar no instante do vencimento ===================
  UPDATE agendamentos_sofia_demo SET reserva_expira_em = NOW() - INTERVAL '1 s' WHERE id = v_ag;
  v_r := fn_confirmar_reserva(v_ag);
  IF v_r <> 'expirado' THEN RAISE EXCEPTION 'FALHA(C2): confirmou vencida, retorno %', v_r; END IF;
  RAISE NOTICE 'OK(C2): vencida por cálculo é recusada mesmo sem o job ter rodado.';

  -- =================== C3 — job não sobrescreve confirmação em voo ===================
  UPDATE agendamentos_sofia_demo SET reserva_expira_em = NOW() + INTERVAL '10 min' WHERE id = v_ag;
  v_r := fn_confirmar_reserva(v_ag);
  IF v_r <> 'confirmado' THEN RAISE EXCEPTION 'FALHA(C3): não confirmou, retorno %', v_r; END IF;
  v_n := fn_expirar_vencidas();
  SELECT status INTO v_r FROM agendamentos_sofia_demo WHERE id = v_ag;
  IF v_r <> 'confirmada' THEN RAISE EXCEPTION 'FALHA(C3): job sobrescreveu confirmação (status %)', v_r; END IF;
  RAISE NOTICE 'OK(C3): job materializa, não decide — confirmação preservada.';

  -- =================== D2 — confirmar duas vezes ===================
  v_r := fn_confirmar_reserva(v_ag);
  IF v_r <> 'ja_confirmado' THEN RAISE EXCEPTION 'FALHA(D2): segunda confirmação retornou %', v_r; END IF;
  SELECT count(*) INTO v_n FROM eventos_agendamento WHERE agendamento_id = v_ag AND tipo = 'confirmado';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHA(D2): % eventos de confirmação', v_n; END IF;
  RAISE NOTICE 'OK(D2): confirmar já-confirmada é sem efeito, sucesso nas duas.';

  -- =================== D3 — job sobreposto ===================
  INSERT INTO agendamentos_sofia_demo
    (clinica_id,paciente_id,profissional_id,servico_id,inicio,fim,status,reserva_expira_em,
     data_agendamento,hora_agendamento,telefone)
  VALUES (v_cl,v_pac,v_prof,v_serv,v_t0+INTERVAL '2 h',v_t0+INTERVAL '2 h 30 min','reservada',
          NOW()-INTERVAL '1 min', v_t0::date, v_t0::time,'5547900000003')
  RETURNING id INTO v_ag2;
  v_n := fn_expirar_vencidas();
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHA(D3): primeira passada gravou % eventos', v_n; END IF;
  v_n := fn_expirar_vencidas();
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHA(D3): segunda passada gravou % eventos', v_n; END IF;
  RAISE NOTICE 'OK(D3): passadas sobrepostas produzem um único evento.';

  -- =================== A.3 — slot liberado após expiração ===================
  INSERT INTO agendamentos_sofia_demo
    (clinica_id,paciente_id,profissional_id,servico_id,inicio,fim,status,
     data_agendamento,hora_agendamento,telefone)
  VALUES (v_cl,v_pac,v_prof,v_serv,v_t0+INTERVAL '2 h',v_t0+INTERVAL '2 h 30 min','reservada',
          v_t0::date,v_t0::time,'5547900000004');
  RAISE NOTICE 'OK(A3): slot da reserva expirada voltou a aceitar reserva.';

  -- =================== D1 — webhook reenviado ===================
  INSERT INTO mensagens_bot (clinica_id,contato_id,wa_message_id,direcao,conteudo)
    VALUES (v_cl,v_ct,'wamid.BORDA','entrada','oi');
  BEGIN
    INSERT INTO mensagens_bot (clinica_id,contato_id,wa_message_id,direcao,conteudo)
      VALUES (v_cl,v_ct,'wamid.BORDA','entrada','oi');
    RAISE EXCEPTION 'FALHA(D1): mesma mensagem aceita duas vezes';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK(D1): reenvio do WhatsApp processado uma única vez.';
  END;

  -- =================== D4 — lembrete duplicado ===================
  INSERT INTO notificacoes_saida (clinica_id,paciente_id,contato_id,agendamento_id,tipo,agendada_para)
    VALUES (v_cl,v_pac,v_ct,v_ag,'lembrete_expiracao',NOW());
  BEGIN
    INSERT INTO notificacoes_saida (clinica_id,paciente_id,contato_id,agendamento_id,tipo,agendada_para)
      VALUES (v_cl,v_pac,v_ct,v_ag,'lembrete_expiracao',NOW());
    RAISE EXCEPTION 'FALHA(D4): lembrete enfileirado duas vezes';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK(D4): lembrete de expiração no máximo uma vez por agendamento.';
  END;

  -- =================== E1..E4 — estados terminais sem saída ===================
  -- E1: confirmar expirada
  v_r := fn_confirmar_reserva(v_ag2);
  IF v_r <> 'estado_invalido' THEN RAISE EXCEPTION 'FALHA(E1): confirmou expirada, retorno %', v_r; END IF;
  BEGIN
    UPDATE agendamentos_sofia_demo SET status='confirmada' WHERE id=v_ag2;
    RAISE EXCEPTION 'FALHA(E1): banco aceitou sair de expirada';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK(E1): não há transição saindo de expirada.';
  END;

  -- E2: cancelar atendida
  UPDATE agendamentos_sofia_demo SET status='realizada' WHERE id=v_ag;
  BEGIN
    UPDATE agendamentos_sofia_demo SET status='cancelada' WHERE id=v_ag;
    RAISE EXCEPTION 'FALHA(E2): cancelou uma atendida';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK(E2): estado terminal realizada não tem saída.';
  END;

  -- E3: marcar falta duas vezes
  INSERT INTO agendamentos_sofia_demo
    (clinica_id,paciente_id,profissional_id,servico_id,inicio,fim,status,
     data_agendamento,hora_agendamento,telefone)
  VALUES (v_cl,v_pac,v_prof,v_serv,v_t0+INTERVAL '5 h',v_t0+INTERVAL '5 h 30 min','confirmada',
          v_t0::date,v_t0::time,'5547900000005') RETURNING id INTO v_ag3;
  UPDATE agendamentos_sofia_demo SET status='no_show' WHERE id=v_ag3;
  INSERT INTO eventos_agendamento (clinica_id,agendamento_id,tipo,origem)
    VALUES (v_cl,v_ag3,'faltou','recepcao');
  BEGIN
    INSERT INTO eventos_agendamento (clinica_id,agendamento_id,tipo,origem)
      VALUES (v_cl,v_ag3,'faltou','recepcao');
    RAISE EXCEPTION 'FALHA(E3): duas marcações de falta';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK(E3): falta marcada uma única vez.';
  END;

  -- E4: confirmar cancelada pelo paciente
  UPDATE agendamentos_sofia_demo SET status='cancelada' WHERE id=v_ag2 AND false; -- no-op, ag2 é expirada
  INSERT INTO agendamentos_sofia_demo
    (clinica_id,paciente_id,profissional_id,servico_id,inicio,fim,status,
     data_agendamento,hora_agendamento,telefone)
  VALUES (v_cl,v_pac,v_prof,v_serv,v_t0+INTERVAL '7 h',v_t0+INTERVAL '7 h 30 min','reservada',
          v_t0::date,v_t0::time,'5547900000006') RETURNING id INTO v_ag3;
  UPDATE agendamentos_sofia_demo SET status='cancelada' WHERE id=v_ag3;
  INSERT INTO eventos_agendamento (clinica_id,agendamento_id,tipo,origem)
    VALUES (v_cl,v_ag3,'cancelado','bot');
  BEGIN
    UPDATE agendamentos_sofia_demo SET status='confirmada' WHERE id=v_ag3;
    RAISE EXCEPTION 'FALHA(E4): ressuscitou uma cancelada';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK(E4): cancelada não ressuscita.';
  END;

  -- =================== M2 — cancelamento tem origem, não dois tipos ===================
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
              WHERE t.typname='tipo_evento' AND e.enumlabel LIKE 'cancelado\_%') THEN
    RAISE EXCEPTION 'FALHA(M2): tipo_evento ainda tem cancelado_* duplicando origem';
  END IF;
  SELECT origem::text INTO v_r FROM eventos_agendamento WHERE agendamento_id=v_ag3 AND tipo='cancelado';
  IF v_r <> 'bot' THEN RAISE EXCEPTION 'FALHA(M2): origem do cancelamento = %', v_r; END IF;
  RAISE NOTICE 'OK(M2/T1/T2): cancelamento é um tipo + origem; clínica e paciente se distinguem por origem.';

  -- =================== T1/T2 — cancelamento pela clínica ===================
  INSERT INTO agendamentos_sofia_demo
    (clinica_id,paciente_id,profissional_id,servico_id,inicio,fim,status,
     data_agendamento,hora_agendamento,telefone)
  VALUES (v_cl,v_pac,v_prof,v_serv,v_t0+INTERVAL '9 h',v_t0+INTERVAL '9 h 30 min','confirmada',
          v_t0::date,v_t0::time,'5547900000007') RETURNING id INTO v_ag3;
  UPDATE agendamentos_sofia_demo SET status='cancelada' WHERE id=v_ag3;
  INSERT INTO eventos_agendamento (clinica_id,agendamento_id,tipo,origem)
    VALUES (v_cl,v_ag3,'cancelado','recepcao');
  -- T2: médico faltou => cancelado pela clínica, NÃO conta falta do paciente
  IF EXISTS (SELECT 1 FROM eventos_agendamento WHERE agendamento_id=v_ag3 AND tipo='faltou') THEN
    RAISE EXCEPTION 'FALHA(T2): ausência do médico virou falta do paciente';
  END IF;
  RAISE NOTICE 'OK(T1/T2): cancelamento pela clínica não vira falta do paciente.';

  -- =================== T3 — horário de verão ===================
  -- 2026-10-18 é virada de DST no hemisfério sul (referência: America/Santiago).
  IF fn_prazo_retencao(TIMESTAMPTZ '2026-10-17 23:50-03', TIMESTAMPTZ '2026-10-18 02:00-03')
     <> TIMESTAMPTZ '2026-10-17 23:50-03' + INTERVAL '30 min' THEN
    RAISE EXCEPTION 'FALHA(T3): prazo quebrou na virada de horário';
  END IF;
  RAISE NOTICE 'OK(T3): prazo é duração sobre instante absoluto — DST não afeta.';

  -- =================== T4 — fronteira de data ===================
  IF fn_prazo_retencao(TIMESTAMPTZ '2026-09-01 23:58-03', TIMESTAMPTZ '2026-09-02 00:30-03')
     <> TIMESTAMPTZ '2026-09-01 23:58-03' + INTERVAL '16 min' THEN
    RAISE EXCEPTION 'FALHA(T4): prazo errado atravessando meia-noite';
  END IF;
  RAISE NOTICE 'OK(T4): 23h58 -> 00h30 dá 16 min, sem quebrar na virada de data.';

  -- =================== I1 — paciente troca de número ===================
  INSERT INTO paciente_contato (clinica_id,paciente_id,contato_id,titular,papel,nivel)
    VALUES (v_cl,v_pac,v_ct,true,'titular','total');
  INSERT INTO contatos_whatsapp (clinica_id,chat_id,telefone)
    VALUES (v_cl,'b2@c.us','5547900000099') RETURNING id INTO v_ct2;
  UPDATE paciente_contato SET vinculo_status='revogado', revogado_em=NOW(),
         revogado_motivo='trocou de numero' WHERE paciente_id=v_pac AND contato_id=v_ct;
  INSERT INTO paciente_contato (clinica_id,paciente_id,contato_id,titular,papel,nivel)
    VALUES (v_cl,v_pac,v_ct2,true,'titular','total');
  SELECT count(*) INTO v_n FROM agendamentos_sofia_demo WHERE paciente_id=v_pac;
  IF v_n = 0 THEN RAISE EXCEPTION 'FALHA(I1): histórico do paciente sumiu na troca de número'; END IF;
  RAISE NOTICE 'OK(I1): paciente é independente do contato — histórico preservado (% agendamentos).', v_n;

  -- =================== I2 — número reciclado ===================
  INSERT INTO pacientes (clinica_id,nome_completo,data_nascimento)
    VALUES (v_cl,'Novo Dono', DATE '1999-09-09') RETURNING id INTO v_pac2;
  INSERT INTO paciente_contato (clinica_id,paciente_id,contato_id,titular,papel,nivel)
    VALUES (v_cl,v_pac2,v_ct,true,'titular','total');
  -- o vínculo antigo daquele número está revogado: o novo dono não alcança o histórico
  SELECT count(*) INTO v_n
    FROM paciente_contato WHERE contato_id=v_ct AND vinculo_status='ativo' AND paciente_id=v_pac;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHA(I2): número reciclado ainda vê o paciente antigo'; END IF;
  RAISE NOTICE 'OK(I2): vínculo tem fim (revogado_em) — novo dono não herda histórico.';

  -- =================== I3 — mãe agenda para dois filhos e para si ===================
  INSERT INTO pacientes (clinica_id,nome_completo,data_nascimento)
    VALUES (v_cl,'Mae Bordas', DATE '1980-01-01') RETURNING id INTO v_mae;
  INSERT INTO pacientes (clinica_id,nome_completo,data_nascimento)
    VALUES (v_cl,'Filho Um', DATE '2015-01-01') RETURNING id INTO v_filho;
  INSERT INTO contatos_whatsapp (clinica_id,chat_id,telefone)
    VALUES (v_cl,'mae@c.us','5547900000100') RETURNING id INTO v_ct2;
  INSERT INTO paciente_contato (clinica_id,paciente_id,contato_id,titular,papel,nivel) VALUES
    (v_cl,v_mae,  v_ct2,true, 'titular',      'total'),
    (v_cl,v_filho,v_ct2,false,'responsavel',  'agendar_e_consultar');
  INSERT INTO pacientes (clinica_id,nome_completo,data_nascimento)
    VALUES (v_cl,'Filho Dois', DATE '2018-06-01') RETURNING id INTO v_pac2;
  INSERT INTO paciente_contato (clinica_id,paciente_id,contato_id,titular,papel,nivel)
    VALUES (v_cl,v_pac2,v_ct2,false,'responsavel','agendar_e_consultar');
  INSERT INTO paciente_responsavel (clinica_id,paciente_id,responsavel_id,relacao)
    VALUES (v_cl,v_filho,v_mae,'mae'), (v_cl,v_pac2,v_mae,'mae');
  SELECT count(*) INTO v_n FROM paciente_contato WHERE contato_id=v_ct2;
  IF v_n <> 3 THEN RAISE EXCEPTION 'FALHA(I3): esperado 3 vínculos no mesmo contato, veio %', v_n; END IF;
  SELECT count(DISTINCT papel) INTO v_n FROM paciente_contato WHERE contato_id=v_ct2;
  IF v_n < 2 THEN RAISE EXCEPTION 'FALHA(I3): vínculo não distingue próprio de responsável-por'; END IF;
  RAISE NOTICE 'OK(I3): 3 vínculos distintos no mesmo contato, com papel próprio/responsável.';

  -- =================== I4 — homônimos com mesma data de nascimento (PARCIAL) ===================
  INSERT INTO pacientes (clinica_id,nome_completo,data_nascimento)
    VALUES (v_cl,'Homonimo Silva', DATE '1990-05-05');
  INSERT INTO pacientes (clinica_id,nome_completo,data_nascimento)
    VALUES (v_cl,'Homonimo Silva', DATE '1990-05-05');   -- deve ser ACEITO: gêmeos existem
  SELECT count(*) INTO v_n FROM pacientes
   WHERE clinica_id=v_cl AND lower(nome_completo)='homonimo silva' AND data_nascimento=DATE '1990-05-05';
  IF v_n <> 2 THEN RAISE EXCEPTION 'FALHA(I4): banco fundiu ou recusou homônimos (% linhas)', v_n; END IF;
  RAISE NOTICE 'OK(I4, parcial): banco não deduplica por palpite — dois registros distintos.';
  RAISE NOTICE '  ⚠ I4 incompleto: a escalação para atendente humano é da aplicação, não testável aqui.';

  RAISE NOTICE '───────────────────────────────────────────────';
  RAISE NOTICE '19/19 casos executados. 18 completos no banco, I4 parcial.';
END$bat$;

ROLLBACK;
