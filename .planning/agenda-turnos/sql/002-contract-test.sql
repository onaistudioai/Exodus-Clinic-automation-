-- ============================================================================
-- 002-contract-test.sql — Contrato Agenda+Turnos (QA / Fase 4 OPUS).
-- Sentinela: termina com RAISE 'AGENDA_CONTRACT_PASS' (força rollback; nada persiste).
-- Qualquer FALHA dispara mensagem diferente. Roda como superuser; usa a clínica 2 (Bella).
-- ============================================================================
DO $$
DECLARE
  k_clin CONSTANT INT := 2;
  v_prof INT; v_serv INT; v_dow INT; v_dfut DATE; t0 TIMESTAMPTZ; v_n INT; v_err BOOLEAN;
BEGIN
  PERFORM set_config('app.clinica_id', k_clin::text, true);
  SELECT id INTO v_prof FROM profissionais WHERE clinica_id=k_clin ORDER BY id LIMIT 1;
  SELECT id INTO v_serv FROM servicos WHERE clinica_id=k_clin ORDER BY id LIMIT 1;
  IF v_prof IS NULL OR v_serv IS NULL THEN
    RAISE EXCEPTION 'CONTRATO: faltam profissional/servico na clínica % (backfill?)', k_clin;
  END IF;

  v_dfut := CURRENT_DATE + 40;
  v_dow  := extract(dow from v_dfut)::int;
  t0     := (v_dfut + time '09:00') AT TIME ZONE 'America/Sao_Paulo';

  -- turno 08:00–12:00 no dia futuro
  INSERT INTO turnos (clinica_id, profissional_id, dia_semana, hora_inicio, hora_fim, vigencia_inicio)
  VALUES (k_clin, v_prof, v_dow, '08:00', '12:00', CURRENT_DATE);

  -- agendamento A às 09:00 (30min)
  INSERT INTO agendamentos_sofia_demo
    (clinica_id, profissional_id, servico_id, inicio, fim, data_agendamento, hora_agendamento, status)
  VALUES (k_clin, v_prof, v_serv, t0, t0 + interval '30 min', v_dfut, '09:00', 'confirmada');

  -- ===== 1) slotsLivres: janela 08–12 (8 slots de 30min) − 1 ocupado (09:00) = 7 =====
  WITH janelas AS (
    SELECT (v_dfut + t.hora_inicio) AT TIME ZONE 'America/Sao_Paulo' AS wi,
           (v_dfut + t.hora_fim)    AT TIME ZONE 'America/Sao_Paulo' AS wf
      FROM turnos t WHERE t.clinica_id=k_clin AND t.profissional_id=v_prof AND t.ativo
        AND t.dia_semana=v_dow AND t.vigencia_inicio<=v_dfut
  ),
  cand AS (
    SELECT gs AS inicio, gs + interval '30 min' AS fim
      FROM janelas j, generate_series(j.wi, j.wf - interval '30 min', interval '30 min') gs
  )
  SELECT count(*) INTO v_n FROM cand c
   WHERE NOT EXISTS (SELECT 1 FROM bloqueios b WHERE b.clinica_id=k_clin
            AND (b.profissional_id=v_prof OR b.profissional_id IS NULL)
            AND tstzrange(b.inicio,b.fim,'[)') && tstzrange(c.inicio,c.fim,'[)'))
     AND NOT EXISTS (SELECT 1 FROM agendamentos_sofia_demo a WHERE a.clinica_id=k_clin
            AND a.profissional_id=v_prof AND a.status NOT IN ('cancelada','no_show')
            AND a.inicio IS NOT NULL AND a.fim IS NOT NULL
            AND tstzrange(a.inicio,a.fim,'[)') && tstzrange(c.inicio,c.fim,'[)'));
  IF v_n <> 7 THEN RAISE EXCEPTION 'FALHA 1: esperava 7 slots livres, veio %', v_n; END IF;
  RAISE NOTICE 'OK 1: slotsLivres exclui o horário ocupado (7 livres)';

  -- ===== 2) anti-overbooking: B sobrepõe A (mesmo prof, ativo) → 23P01 =====
  v_err := false;
  BEGIN
    INSERT INTO agendamentos_sofia_demo
      (clinica_id, profissional_id, servico_id, inicio, fim, data_agendamento, hora_agendamento, status)
    VALUES (k_clin, v_prof, v_serv, t0 + interval '15 min', t0 + interval '45 min', v_dfut, '09:15', 'confirmada');
  EXCEPTION WHEN exclusion_violation THEN v_err := true; END;
  IF NOT v_err THEN RAISE EXCEPTION 'FALHA 2: sobreposição deveria ser barrada pela exclusion constraint'; END IF;
  RAISE NOTICE 'OK 2: anti-overbooking barra sobreposição';

  -- ===== 3) encaixe explícito (overbooking_intencional) pula a trava =====
  INSERT INTO agendamentos_sofia_demo
    (clinica_id, profissional_id, servico_id, inicio, fim, data_agendamento, hora_agendamento, status, overbooking_intencional)
  VALUES (k_clin, v_prof, v_serv, t0 + interval '15 min', t0 + interval '45 min', v_dfut, '09:15', 'confirmada', true);
  RAISE NOTICE 'OK 3: encaixe (overbooking_intencional) permitido';

  -- ===== 4) cancelada libera o horário (sai do predicado da constraint) =====
  INSERT INTO agendamentos_sofia_demo
    (clinica_id, profissional_id, servico_id, inicio, fim, data_agendamento, hora_agendamento, status)
  VALUES (k_clin, v_prof, v_serv, t0, t0 + interval '30 min', v_dfut, '09:00', 'cancelada');
  RAISE NOTICE 'OK 4: status cancelada não conflita';

  -- ===== 5) RLS fail-closed + cross-tenant (sob app_painel) =====
  SET LOCAL ROLE app_painel;
  PERFORM set_config('app.clinica_id','', true);
  SELECT count(*) INTO v_n FROM turnos;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHA 5: RLS fail-closed violada (% turnos sem GUC)', v_n; END IF;
  PERFORM set_config('app.clinica_id','999999', true);
  SELECT count(*) INTO v_n FROM agendamentos_sofia_demo;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHA 5b: isolamento violado (% agendamentos p/ clínica fantasma)', v_n; END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 5: RLS fail-closed + cross-tenant';

  RAISE EXCEPTION 'AGENDA_CONTRACT_PASS: 5/5 checagens OK (rollback, nada persistido)';
END$$;
