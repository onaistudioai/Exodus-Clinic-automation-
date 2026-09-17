-- pront-contract-test.sql — QA dedicada do PRONTUÁRIO (garantias do modelo).
-- Auto-verificável (RAISE em falha) + BEGIN..ROLLBACK (não deixa lixo).
-- Clínica Aurora = 2; usa paciente id=7, médico id=3, agendamento id=10 (existentes).
-- RLS testada sob SET LOCAL ROLE app_painel (runner é superuser e bypassa RLS).
BEGIN;
SET LOCAL app.clinica_id = '2';

DO $$
DECLARE r1 int; n int; ag_status text; v_email text;
BEGIN
  -- ===== Fase A: triggers/constraints/funções (como superuser) =====

  -- cria um rascunho p/ paciente 7, médico 3, ligado ao agendamento 10
  INSERT INTO prontuario_entradas (clinica_id, paciente_id, agendamento_id, profissional_id, estado)
    VALUES (2, 7, 10, 3, 'rascunho') RETURNING id INTO r1;

  -- (1) append-only: DELETE proibido sempre (mesmo rascunho).
  BEGIN
    DELETE FROM prontuario_entradas WHERE id = r1;
    RAISE EXCEPTION 'FALHA(1): DELETE em prontuario_entradas deveria ser bloqueado';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHA(%' THEN RAISE; END IF; -- erro do trigger é o esperado
  END;

  -- (2) finaliza -> marca agendamento como 'realizada'.
  UPDATE agendamentos_sofia_demo SET status = 'confirmada' WHERE id = 10 AND clinica_id = 2;
  UPDATE prontuario_entradas
     SET estado = 'finalizado', texto_clinico = 'qa contrato', tipo_atendimento = 'consulta',
         precisa_retorno = false, finalizado_por = 3
   WHERE id = r1 AND estado = 'rascunho';
  SELECT status INTO ag_status FROM agendamentos_sofia_demo WHERE id = 10;
  IF ag_status IS DISTINCT FROM 'realizada' THEN
    RAISE EXCEPTION 'FALHA(2): agendamento deveria virar realizada, está %', ag_status;
  END IF;
  -- finalizado_em deve ter sido setado pelo trigger
  IF (SELECT finalizado_em FROM prontuario_entradas WHERE id = r1) IS NULL THEN
    RAISE EXCEPTION 'FALHA(2b): finalizado_em deveria ser setado na finalização';
  END IF;

  -- (3) finalizado é IMUTÁVEL: alterar texto clínico deve ser bloqueado.
  BEGIN
    UPDATE prontuario_entradas SET texto_clinico = 'editado' WHERE id = r1;
    RAISE EXCEPTION 'FALHA(3): entrada finalizada deveria ser imutável';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHA(%' THEN RAISE; END IF;
  END;

  -- (4) chk_finalizado_exige_tags: finalizado sem tipo_atendimento deve violar.
  BEGIN
    INSERT INTO prontuario_entradas
      (clinica_id, paciente_id, profissional_id, estado, texto_clinico, precisa_retorno)
      VALUES (2, 7, 3, 'finalizado', 'sem tags', false);
    RAISE EXCEPTION 'FALHA(4): finalizado sem tipo_atendimento deveria violar chk_finalizado_exige_tags';
  EXCEPTION WHEN check_violation THEN NULL; -- esperado
  END;

  -- (5) fn_e_menor: < 18 anos.
  IF fn_e_menor((CURRENT_DATE - INTERVAL '10 years')::date) IS NOT TRUE THEN
    RAISE EXCEPTION 'FALHA(5a): 10 anos deveria ser menor (TRUE)';
  END IF;
  IF fn_e_menor((CURRENT_DATE - INTERVAL '30 years')::date) IS NOT FALSE THEN
    RAISE EXCEPTION 'FALHA(5b): 30 anos não deveria ser menor (FALSE)';
  END IF;

  -- guarda um email de usuário ATIVO p/ o teste de login (pode não existir).
  SELECT email INTO v_email FROM usuarios WHERE ativo = true AND email IS NOT NULL LIMIT 1;

  -- ===== Fase B: RLS + grants sob role do app (app_painel) =====
  EXECUTE 'SET LOCAL ROLE app_painel';

  -- (6) controle positivo: com GUC=2 o app_painel VÊ entradas da Aurora (paciente 7 tem).
  PERFORM set_config('app.clinica_id', '2', true);
  SELECT count(*) INTO n FROM prontuario_entradas WHERE paciente_id = 7;
  IF n < 1 THEN RAISE EXCEPTION 'FALHA(6): com GUC=2 deveria ver entradas do paciente 7'; END IF;

  -- (7) RLS fail-closed: sem GUC -> 0 entradas e 0 acessos.
  PERFORM set_config('app.clinica_id', '', true);
  SELECT count(*) INTO n FROM prontuario_entradas;
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA(7a): sem GUC deveria ver 0 entradas, viu %', n; END IF;
  SELECT count(*) INTO n FROM prontuario_acessos;
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA(7b): sem GUC deveria ver 0 acessos, viu %', n; END IF;

  -- (8) RLS isolamento: clínica 1 não vê entradas da clínica 2.
  PERFORM set_config('app.clinica_id', '1', true);
  SELECT count(*) INTO n FROM prontuario_entradas WHERE paciente_id = 7;
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA(8): clínica 1 não deveria ver entradas da clínica 2'; END IF;
  PERFORM set_config('app.clinica_id', '2', true);

  -- (9) app_painel NÃO tem DELETE em prontuario_entradas (defesa em profundidade).
  BEGIN
    DELETE FROM prontuario_entradas WHERE id = -999999;
    RAISE EXCEPTION 'FALHA(9): app_painel não deveria ter DELETE em prontuario_entradas';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL; -- esperado
    WHEN raise_exception THEN IF SQLERRM LIKE 'FALHA(%' THEN RAISE; END IF;
  END;

  -- (10) fn_login_lookup (SECURITY DEFINER) acha user ativo mesmo sem GUC,
  --      enquanto SELECT direto em usuarios sem GUC = fail-closed.
  IF v_email IS NOT NULL THEN
    PERFORM set_config('app.clinica_id', '', true);
    BEGIN
      SELECT count(*) INTO n FROM usuarios WHERE lower(email) = lower(v_email);
      IF n <> 0 THEN RAISE EXCEPTION 'FALHA(10a): SELECT direto em usuarios sem GUC deveria dar 0, deu %', n; END IF;
    EXCEPTION WHEN insufficient_privilege THEN NULL; -- sem grant também é fail-closed
    END;
    SELECT count(*) INTO n FROM fn_login_lookup(v_email);
    IF n < 1 THEN RAISE EXCEPTION 'FALHA(10b): fn_login_lookup deveria achar o user ativo (%).', v_email; END IF;
  END IF;

  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'PRONT CONTRACT OK';
END$$;

ROLLBACK;
SELECT 'PRONT CONTRACT TEST PASSED (rolled back, sem lixo)' AS status;
