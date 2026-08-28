-- 002-contract-test-prontuario.sql — prova a FRONTEIRA do Prontuário (001-fronteira.sql).
--
-- Padrão dos demais contract-tests: auto-verificável (RAISE EXCEPTION por falha) e
-- sem lixo (BEGIN ... ROLLBACK). Rodar como SUPERUSER: a asserção (3) desce para
-- `SET LOCAL ROLE app_painel` (NOBYPASSRLS), que é onde a RLS constrange de verdade.
--
-- As três coisas que o desenho promete e que ninguém deve poder desfazer sem quebrar:
--   1. as views não expõem texto clínico;
--   2. expurgada some da fronteira e PERMANECE no indicador;
--   3. security_invoker está de fato ativo (sem ele, a view vaza cross-tenant).
BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- (1) Nenhuma das views carrega campo de conteúdo clínico.
--     É esta asserção que torna o vazamento estrutural, não disciplinar.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE vazando text;
BEGIN
  SELECT string_agg(table_name || '.' || column_name, ', ') INTO vazando
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN ('v_prontuario_visivel','v_prontuario_indicador')
     AND column_name IN ('texto_clinico','orientacoes_paciente');
  IF vazando IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA (1): view de fronteira expõe conteúdo clínico: %', vazando;
  END IF;
  -- guarda contra o falso-positivo óbvio: as views existirem de verdade.
  IF (SELECT count(*) FROM pg_class WHERE relkind = 'v'
       AND relname IN ('v_prontuario_visivel','v_prontuario_indicador')) <> 2 THEN
    RAISE EXCEPTION 'FALHA (1): as duas views da fronteira não existem';
  END IF;
  RAISE NOTICE 'OK (1): views da fronteira sem texto_clinico/orientacoes_paciente';
END$$;

-- ───────────────────────────────────────────────────────────────────────────
-- (2) Expurgada sai da fronteira, fica no indicador (decisão: o material foi
--     consumido e a cobrança foi emitida — ver comentário em 001-fronteira.sql).
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  ca int; pac int; prof int; ent int; n_vis int; n_ind int;
BEGIN
  SELECT id INTO ca FROM clinicas WHERE nome = '[TESTE] Clinica A';
  PERFORM set_config('app.clinica_id', ca::text, true);

  INSERT INTO usuarios (clinica_id, nome, papel)
       VALUES (ca, '[TESTE] Medico', 'medico') RETURNING id INTO prof;
  INSERT INTO pacientes (clinica_id, nome_completo, data_nascimento)
       VALUES (ca, '[TESTE] Fronteira', DATE '1990-01-01') RETURNING id INTO pac;
  INSERT INTO prontuario_entradas
         (clinica_id, paciente_id, profissional_id, estado, expurgado,
          expurgado_em, expurgo_motivo, tipo_atendimento)
       VALUES (ca, pac, prof, 'rascunho', true, NOW(), '[TESTE]', 'consulta')
    RETURNING id INTO ent;

  SELECT count(*) INTO n_vis FROM v_prontuario_visivel   WHERE id = ent;
  SELECT count(*) INTO n_ind FROM v_prontuario_indicador WHERE id = ent;
  IF n_vis <> 0 THEN
    RAISE EXCEPTION 'FALHA (2): entrada expurgada apareceu em v_prontuario_visivel';
  END IF;
  IF n_ind <> 1 THEN
    RAISE EXCEPTION 'FALHA (2): entrada expurgada sumiu de v_prontuario_indicador '
                    '(custo de material real viraria zero)';
  END IF;
  RAISE NOTICE 'OK (2): expurgada fora da fronteira, dentro do indicador';
END$$;

-- ───────────────────────────────────────────────────────────────────────────
-- (3) security_invoker: sob app_painel com o GUC da clínica A, nenhuma linha da
--     clínica B aparece. Sem security_invoker a view rodaria como o DONO (que
--     bypassa RLS) e devolveria as duas clínicas.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  ca int; cb int; pac_b int; prof_b int; vazou int;
BEGIN
  SELECT id INTO ca FROM clinicas WHERE nome = '[TESTE] Clinica A';
  SELECT id INTO cb FROM clinicas WHERE nome = '[TESTE] Clinica B';

  PERFORM set_config('app.clinica_id', cb::text, true);
  INSERT INTO usuarios (clinica_id, nome, papel)
       VALUES (cb, '[TESTE] Medico B', 'medico') RETURNING id INTO prof_b;
  INSERT INTO pacientes (clinica_id, nome_completo, data_nascimento)
       VALUES (cb, '[TESTE] Fronteira B', DATE '1990-01-01') RETURNING id INTO pac_b;
  INSERT INTO prontuario_entradas (clinica_id, paciente_id, profissional_id, estado)
       VALUES (cb, pac_b, prof_b, 'rascunho');

  PERFORM set_config('app.clinica_id', ca::text, true);
  SET LOCAL ROLE app_painel;
  SELECT (SELECT count(*) FROM v_prontuario_visivel   WHERE clinica_id = cb)
       + (SELECT count(*) FROM v_prontuario_indicador WHERE clinica_id = cb)
    INTO vazou;
  RESET ROLE;

  IF vazou <> 0 THEN
    RAISE EXCEPTION 'FALHA (3): app_painel na clinica % viu % linha(s) da clinica % '
                    'pelas views — security_invoker não está ativo', ca, vazou, cb;
  END IF;
  RAISE NOTICE 'OK (3): views fail-closed por tenant sob app_painel';
END$$;

ROLLBACK;
