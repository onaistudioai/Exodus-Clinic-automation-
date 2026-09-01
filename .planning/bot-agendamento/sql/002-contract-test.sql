-- ============================================================================
-- 002-contract-test.sql — asserções dos critérios de aceitação da spec v1.1.
-- Cobre 1 (I1), 3 (I8), 4 (I2), 8 (I3/I6), 10 (I10), 11 (retenção).
-- BEGIN..ROLLBACK: não deixa rastro. Roda como superuser (SET ROLE p/ testar app_painel).
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_clinica  INT;
  v_outra    INT;
  v_prof     INT;
  v_serv     INT;
  v_pac      INT;
  v_ag       INT;
  v_n        INT;
  v_txt      TEXT;
  v_base     TIMESTAMPTZ := date_trunc('hour', NOW()) + INTERVAL '30 day';
BEGIN
  SELECT id INTO v_clinica FROM clinicas WHERE nome = '[TESTE] Clinica A';
  SELECT id INTO v_outra   FROM clinicas WHERE nome = '[TESTE] Clinica B';
  IF v_clinica IS NULL OR v_outra IS NULL THEN
    RAISE EXCEPTION 'seed ausente: rode verify.mjs antes';
  END IF;

  INSERT INTO profissionais (clinica_id, nome) VALUES (v_clinica, 'Dra Teste V11')
    RETURNING id INTO v_prof;
  INSERT INTO servicos (clinica_id, nome, duracao_min) VALUES (v_clinica, 'Consulta V11', 30)
    RETURNING id INTO v_serv;
  INSERT INTO pacientes (clinica_id, nome_completo, data_nascimento)
    VALUES (v_clinica, 'Paciente V11', DATE '1990-01-01') RETURNING id INTO v_pac;

  -- ==== critério 1 — I1: duas reservas no mesmo horário, uma falha ====
  INSERT INTO agendamentos_sofia_demo
    (clinica_id, paciente_id, profissional_id, servico_id, inicio, fim, status,
     reserva_expira_em, data_agendamento, hora_agendamento, telefone)
  VALUES (v_clinica, v_pac, v_prof, v_serv, v_base, v_base + INTERVAL '30 min', 'reservada',
          NOW() + INTERVAL '15 min', v_base::date, v_base::time, '5547999999999')
  RETURNING id INTO v_ag;

  BEGIN
    INSERT INTO agendamentos_sofia_demo
      (clinica_id, paciente_id, profissional_id, servico_id, inicio, fim, status,
       data_agendamento, hora_agendamento, telefone)
    VALUES (v_clinica, v_pac, v_prof, v_serv, v_base + INTERVAL '10 min',
            v_base + INTERVAL '40 min', 'agendada', v_base::date, v_base::time, '5547999999998');
    RAISE EXCEPTION 'FALHA(1): overbooking sobreposto foi aceito';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'OK(1): I1 — sobreposição recusada pelo banco (conflito_de_vaga).';
  END;

  -- ==== critério 8 — I3/I6: status da linha == tipo do evento de maior id ====
  INSERT INTO eventos_agendamento (clinica_id, agendamento_id, tipo, origem)
  VALUES (v_clinica, v_ag, 'criado', 'bot'), (v_clinica, v_ag, 'reservado', 'bot');

  SELECT tipo::text INTO v_txt FROM eventos_agendamento
   WHERE agendamento_id = v_ag ORDER BY id DESC LIMIT 1;
  IF v_txt <> 'reservado' THEN
    RAISE EXCEPTION 'FALHA(8): último evento por id = %, esperado reservado', v_txt;
  END IF;
  -- a prova de que I3 precisava mudar: por ocorrido_em o desempate é indeterminado.
  SELECT count(DISTINCT ocorrido_em) INTO v_n FROM eventos_agendamento WHERE agendamento_id = v_ag;
  IF v_n <> 1 THEN
    RAISE NOTICE '  (nota: eventos da mesma transação tiveram ocorrido_em distintos)';
  ELSE
    RAISE NOTICE 'OK(8): I3 — 2 eventos, mesmo ocorrido_em, desempate por id funciona.';
  END IF;

  -- ==== critério 3 — I8: expirar() libera a vaga ====
  UPDATE agendamentos_sofia_demo SET reserva_expira_em = NOW() - INTERVAL '1 min' WHERE id = v_ag;
  -- expirar(): status + evento na mesma transação
  UPDATE agendamentos_sofia_demo SET status = 'expirada'
   WHERE status = 'reservada' AND reserva_expira_em < NOW();
  INSERT INTO eventos_agendamento (clinica_id, agendamento_id, tipo, origem)
  VALUES (v_clinica, v_ag, 'expirado', 'sistema');

  INSERT INTO agendamentos_sofia_demo
    (clinica_id, paciente_id, profissional_id, servico_id, inicio, fim, status,
     data_agendamento, hora_agendamento, telefone)
  VALUES (v_clinica, v_pac, v_prof, v_serv, v_base, v_base + INTERVAL '30 min', 'agendada',
          v_base::date, v_base::time, '5547999999997');
  RAISE NOTICE 'OK(3): I8 — reserva expirada liberou o horário, novo agendamento aceito.';

  -- idempotência de expirar(): rodar de novo não muda nada
  UPDATE agendamentos_sofia_demo SET status = 'expirada'
   WHERE status = 'reservada' AND reserva_expira_em < NOW();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHA(3): expirar() não é idempotente (% linhas)', v_n; END IF;

  -- ==== critério 11 — retenção de mensagens_bot ====
  INSERT INTO contatos_whatsapp (clinica_id, chat_id, telefone)
    VALUES (v_clinica, 'v11@c.us', '5547999999999');
  INSERT INTO mensagens_bot (clinica_id, contato_id, wa_message_id, direcao, conteudo, ocorrido_em)
    SELECT v_clinica, id, 'wamid.V11', 'entrada', 'meu nome é Fulano, cpf 000',
           NOW() - INTERVAL '400 day' FROM contatos_whatsapp WHERE chat_id = 'v11@c.us';

  -- fn_expurgo_mensagens virou SECURITY INVOKER por tenant em 2026-09-01
  -- (camada-a-v2/008-inventario-alcance.sql — era DEFINER e varria TODAS as
  -- clínicas de uma vez, achado medido em produção). Sem o GUC, ela agora
  -- levanta exceção em vez de rodar cross-tenant; este teste precisa declarar
  -- o tenant, como qualquer chamador real passaria a fazer.
  PERFORM set_config('app.clinica_id', v_clinica::text, true);
  SELECT fn_expurgo_mensagens(180) INTO v_n;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHA(11): expurgo tocou % linhas, esperado 1', v_n; END IF;
  SELECT fn_expurgo_mensagens(180) INTO v_n;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHA(11): expurgo não é idempotente (% linhas)', v_n; END IF;
  PERFORM 1 FROM mensagens_bot WHERE wa_message_id = 'wamid.V11' AND conteudo IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHA(11): conteudo não foi zerado ou wa_message_id sumiu'; END IF;
  RAISE NOTICE 'OK(11): retenção — conteudo zerado, wa_message_id preservado, idempotente.';

  -- ==== critério 4 — I2: eventos são append-only para a aplicação ====
  PERFORM 1 FROM information_schema.table_privileges
   WHERE table_name = 'eventos_agendamento' AND grantee IN ('app_painel','app_n8n')
     AND privilege_type IN ('UPDATE','DELETE');
  IF FOUND THEN RAISE EXCEPTION 'FALHA(4): app_* ainda tem UPDATE/DELETE em eventos_agendamento'; END IF;
  RAISE NOTICE 'OK(4): I2 — app_painel/app_n8n sem UPDATE nem DELETE em eventos_agendamento.';

  -- ==== critério 10 — I10: RLS FORCE + policy nas 4 tabelas novas ====
  SELECT count(*) INTO v_n FROM pg_class c
   WHERE c.relname IN ('eventos_agendamento','mensagens_bot','interacoes','notificacoes_saida')
     AND c.relrowsecurity AND c.relforcerowsecurity
     AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'rls_tenant');
  IF v_n <> 4 THEN RAISE EXCEPTION 'FALHA(10): só % de 4 tabelas com RLS FORCE + policy', v_n; END IF;
  RAISE NOTICE 'OK(10a): I10 — 4/4 tabelas novas com RLS FORCE e policy de tenant.';
END$$;

-- ==== critério 10 (parte 2) — fail-closed sob app_painel ====
DO $$
DECLARE v_n INT;
BEGIN
  SET LOCAL ROLE app_painel;
  PERFORM set_config('app.clinica_id', '', true);
  SELECT count(*) INTO v_n FROM eventos_agendamento;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHA(10): sem tenant, eventos_agendamento devolveu % linhas', v_n; END IF;
  RAISE NOTICE 'OK(10b): fail-closed — sem app.clinica_id, zero linhas.';
  RESET ROLE;
END$$;

DO $$ BEGIN RAISE NOTICE 'TODAS AS ASSERÇÕES PASSARAM.'; END$$;

ROLLBACK;
