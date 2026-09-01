-- ============================================================================
-- 009-contract-test-fonte-unica.sql — prova que estado e alcance têm UMA fonte.
-- BEGIN ... ROLLBACK. Pré-requisito: v2/007 e v2/008.
--
-- Os testes (1)-(4) falhavam antes de 007. Os (5)-(8) são as duas regras do
-- inventário. Cada um existe porque um bug real passou pela ausência dele.
-- ============================================================================
BEGIN;
SET LOCAL app.clinica_id = '2';

DO $$
DECLARE
  v_ag int; v_n int; v_nome text;
BEGIN
  -- ==========================================================================
  -- (1) A FK substituiu o CHECK: estado inexistente é recusado, e a lista
  --     recusadora é a MESMA que a máquina consulta.
  -- ==========================================================================
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'chk_status_agendamento'
                AND conrelid = 'agendamentos_sofia_demo'::regclass) THEN
    RAISE EXCEPTION 'FALHA(1): chk_status_agendamento sobreviveu — a lista voltou a existir em dois lugares';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'fk_status_agendamento'
                    AND conrelid = 'agendamentos_sofia_demo'::regclass) THEN
    RAISE EXCEPTION 'FALHA(1b): FK de status ausente';
  END IF;

  -- ==========================================================================
  -- (2) O vocabulário legado não é mais aceito em lugar nenhum.
  --     'pendente' era o DEFAULT do schema da Bella e o filtro dos 3 workflows.
  -- ==========================================================================
  IF EXISTS (SELECT 1 FROM estado_agendamento
              WHERE estado IN ('pendente','remarcacao_pendente')) THEN
    RAISE EXCEPTION 'FALHA(2): vocabulario legado voltou ao conjunto de estados';
  END IF;
  IF EXISTS (SELECT 1 FROM agendamentos_sofia_demo
              WHERE status IN ('pendente','remarcacao_pendente')) THEN
    RAISE EXCEPTION 'FALHA(2b): sobrou linha com status legado apos a migracao';
  END IF;
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_name = 'agendamentos_sofia_demo' AND column_name = 'status')
     LIKE '%pendente%' THEN
    RAISE EXCEPTION 'FALHA(2c): DEFAULT da coluna status ainda aponta para estado inexistente';
  END IF;

  -- ==========================================================================
  -- (3) O BUG ATIVO. A guarda antiga do trigger omitia 'remarcada', que a
  --     máquina trata como terminal: escalava e a máquina rejeitava logo depois.
  --     Só aparece quando o SET toca status E falhas_classificacao juntos —
  --     um UPDATE só de falhas_classificacao nem dispara t_2 (`OF status` olha
  --     as colunas do SET). Era um bug intermitente.
  -- ==========================================================================
  IF fn_transicao_valida('remarcada','escalado_humano') THEN
    RAISE EXCEPTION 'FALHA(3): remarcada e terminal, nao deveria escalar';
  END IF;

  INSERT INTO agendamentos_sofia_demo
    (chat_id, telefone, data_agendamento, hora_agendamento, status, clinica_id)
  VALUES ('ct-fonte-unica-1','5511999990001', CURRENT_DATE + 3, '10:00', 'agendada', 2)
  RETURNING id INTO v_ag;

  UPDATE agendamentos_sofia_demo SET status = 'remarcada' WHERE id = v_ag;

  BEGIN
    UPDATE agendamentos_sofia_demo
       SET falhas_classificacao = 2, status = 'remarcada'
     WHERE id = v_ag;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'FALHA(3b) BUG ATIVO: guarda da escalada divergiu da maquina em remarcada';
  END;

  IF (SELECT status FROM agendamentos_sofia_demo WHERE id = v_ag) <> 'remarcada' THEN
    RAISE EXCEPTION 'FALHA(3c): agendamento terminal foi escalado assim mesmo';
  END IF;

  -- e a escalada legítima continua funcionando
  INSERT INTO agendamentos_sofia_demo
    (chat_id, telefone, data_agendamento, hora_agendamento, status, clinica_id)
  VALUES ('ct-fonte-unica-2','5511999990002', CURRENT_DATE + 3, '11:00', 'agendada', 2)
  RETURNING id INTO v_ag;
  UPDATE agendamentos_sofia_demo SET falhas_classificacao = 2 WHERE id = v_ag;
  IF (SELECT status FROM agendamentos_sofia_demo WHERE id = v_ag) <> 'escalado_humano' THEN
    RAISE EXCEPTION 'FALHA(3d): 2 falhas nao escalaram um agendamento vivo';
  END IF;

  -- escalado_humano não é beco sem saída
  IF NOT fn_transicao_valida('escalado_humano','confirmada') THEN
    RAISE EXCEPTION 'FALHA(3e): escalado_humano virou terminal';
  END IF;

  -- ==========================================================================
  -- (4) ORDEM DOS TRIGGERS. O Postgres dispara BEFORE em ordem alfabética;
  --     um rename futuro que inverta a ordem reintroduz escalada sem validação.
  -- ==========================================================================
  SELECT string_agg(tgname, ',' ORDER BY tgname) INTO v_nome
    FROM pg_trigger
   WHERE tgrelid = 'agendamentos_sofia_demo'::regclass
     AND NOT tgisinternal
     AND (tgtype & 2) <> 0    -- BEFORE
     AND (tgtype & 16) <> 0;  -- UPDATE
  IF v_nome <> 't_1_escala_por_falhas,t_2_estado_agendamento' THEN
    RAISE EXCEPTION 'FALHA(4) ORDEM: BEFORE UPDATE saiu como [%] — a escalada precisa vir antes da validacao', v_nome;
  END IF;

  -- ==========================================================================
  -- (5) INVENTÁRIO, REGRA 1: toda função SECURITY DEFINER está declarada.
  -- ==========================================================================
  SELECT string_agg(DISTINCT p.proname, ', ') INTO v_nome
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM funcao_alcance fa WHERE fa.funcao = p.proname);
  IF v_nome IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA(5) REGRA 1: funcao SECURITY DEFINER fora do inventario: %', v_nome;
  END IF;

  -- ==========================================================================
  -- (6) INVENTÁRIO, REGRA 2 — a que importa.
  --     Função de alcance `tenant` não pode ser SECURITY DEFINER de um dono com
  --     BYPASSRLS: a declaração não corresponderia ao comportamento. Ou vira
  --     INVOKER, ou a declaração está errada.
  --
  --     Esta regra teria pego fn_expurgo_mensagens ANTES do experimento. A
  --     regra 1 só pegaria se alguem tivesse esquecido de lista-la.
  -- ==========================================================================
  SELECT string_agg(DISTINCT p.proname, ', ') INTO v_nome
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    JOIN funcao_alcance fa ON fa.funcao = p.proname
    JOIN pg_roles r ON r.oid = p.proowner
   WHERE ns.nspname = 'public'
     AND fa.alcance = 'tenant'
     AND p.prosecdef
     AND r.rolbypassrls;
  IF v_nome IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA(6) REGRA 2 INCONSISTENCIA: % declarada tenant mas e SECURITY DEFINER de dono com BYPASSRLS', v_nome;
  END IF;

  -- ==========================================================================
  -- (7) O furo que a validação por pg_proc deixava passar: qualquer função
  --     nullary do catálogo era alvo válido, com direitos do dono.
  -- ==========================================================================
  BEGIN
    PERFORM fn_por_clinica('pg_sleep');
    RAISE EXCEPTION 'FALHA(7) ALVO ARBITRARIO: fn_por_clinica aceitou funcao fora do inventario';
  EXCEPTION WHEN insufficient_privilege THEN NULL;  -- esperado
  END;

  -- (7b) e uma cross_tenant não é varrível clínica a clínica
  BEGIN
    PERFORM fn_por_clinica('fn_login_lookup');
    RAISE EXCEPTION 'FALHA(7b): fn_por_clinica aceitou uma funcao cross_tenant';
  EXCEPTION WHEN insufficient_privilege THEN NULL;  -- esperado
  END;

  -- ==========================================================================
  -- (8) O job por tenant continua exigindo tenant depois de virar INVOKER.
  -- ==========================================================================
  PERFORM set_config('app.clinica_id','',true);
  BEGIN
    PERFORM fn_expurgo_mensagens(180);
    RAISE EXCEPTION 'FALHA(8) SILENCIO: fn_expurgo_mensagens rodou sem tenant';
  EXCEPTION WHEN insufficient_privilege THEN NULL;  -- esperado
  END;
  PERFORM set_config('app.clinica_id','2',true);

  RAISE NOTICE 'OK(fonte-unica) estados, ordem de triggers e inventario de alcance';
END $$;

ROLLBACK;
