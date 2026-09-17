-- 006-contract-test-nivel.sql — prova o backfill e o trigger de
-- 005-nivel-autorizacao.sql.
--
-- O que NÃO é provado aqui: o fail-closed de mudarStatusDoPaciente/
-- proximosAgendamentosDoPaciente (nivelTitularDoPaciente) — é TypeScript, não
-- SQL. Ver tests/integration/nivel-autorizacao.test.ts.
BEGIN;

DO $$
DECLARE
  v_clinica int;
  v_pac int;
  v_cont int;
  v_vinc_titular int;
  v_pac2 int;
  v_cont2 int;
  v_nivel text;
BEGIN
  SELECT id INTO v_clinica FROM clinicas ORDER BY id LIMIT 1;
  PERFORM set_config('app.clinica_id', v_clinica::text, true);

  -- (1) backfill: vínculo titular pré-existente com nivel='nenhum' (simulado
  -- inserindo direto, contornando o trigger, para reproduzir o dado legado que
  -- existia ANTES desta migração) vira 'agendar_e_consultar' ao reaplicar o
  -- UPDATE do backfill.
  INSERT INTO pacientes (clinica_id, nome_completo, data_nascimento)
    VALUES (v_clinica, 'Teste Backfill', '1990-01-01') RETURNING id INTO v_pac;
  INSERT INTO contatos_whatsapp (clinica_id, chat_id, telefone)
    VALUES (v_clinica, '+5511900000097-teste-nivel@c.us', '+5511900000097')
    RETURNING id INTO v_cont;
  ALTER TABLE paciente_contato DISABLE TRIGGER t_nivel_titular_baseline;
  INSERT INTO paciente_contato (clinica_id, paciente_id, contato_id, titular, papel, nivel)
    VALUES (v_clinica, v_pac, v_cont, true, 'titular', 'nenhum')
    RETURNING id INTO v_vinc_titular;
  ALTER TABLE paciente_contato ENABLE TRIGGER t_nivel_titular_baseline;

  UPDATE paciente_contato SET nivel = 'agendar_e_consultar'
   WHERE papel = 'titular' AND nivel = 'nenhum';

  SELECT nivel::text INTO v_nivel FROM paciente_contato WHERE id = v_vinc_titular;
  IF v_nivel <> 'agendar_e_consultar' THEN
    RAISE EXCEPTION 'FALHA(1): backfill deveria ter elevado o titular legado, ficou %.', v_nivel;
  END IF;
  RAISE NOTICE 'OK(1): backfill eleva titular legado (nivel=nenhum) para agendar_e_consultar.';

  -- (2) trigger: novo vínculo TITULAR nasce com agendar_e_consultar, sem
  -- precisar do backfill nem de informar nivel explicitamente.
  INSERT INTO pacientes (clinica_id, nome_completo, data_nascimento)
    VALUES (v_clinica, 'Teste Trigger Titular', '1990-01-01') RETURNING id INTO v_pac2;
  INSERT INTO contatos_whatsapp (clinica_id, chat_id, telefone)
    VALUES (v_clinica, '+5511900000096-teste-nivel@c.us', '+5511900000096')
    RETURNING id INTO v_cont2;
  INSERT INTO paciente_contato (clinica_id, paciente_id, contato_id, titular, papel)
    VALUES (v_clinica, v_pac2, v_cont2, true, 'titular');

  SELECT nivel::text INTO v_nivel FROM paciente_contato
   WHERE paciente_id = v_pac2 AND contato_id = v_cont2;
  IF v_nivel <> 'agendar_e_consultar' THEN
    RAISE EXCEPTION 'FALHA(2): trigger deveria elevar titular novo automaticamente, ficou %.', v_nivel;
  END IF;
  RAISE NOTICE 'OK(2): trigger eleva titular novo para agendar_e_consultar no INSERT.';

  -- (3) vínculo NÃO-titular (autorizado) NÃO ganha nível automático — nem no
  -- backfill, nem no trigger. Só ato humano concede.
  INSERT INTO contatos_whatsapp (clinica_id, chat_id, telefone)
    VALUES (v_clinica, '+5511900000095-teste-nivel@c.us', '+5511900000095')
    RETURNING id INTO v_cont2;
  INSERT INTO paciente_contato (clinica_id, paciente_id, contato_id, titular, papel)
    VALUES (v_clinica, v_pac2, v_cont2, false, 'autorizado');

  SELECT nivel::text INTO v_nivel FROM paciente_contato
   WHERE paciente_id = v_pac2 AND contato_id = v_cont2;
  IF v_nivel <> 'nenhum' THEN
    RAISE EXCEPTION 'FALHA(3): vínculo autorizado não deveria ganhar nível automático, ficou %.', v_nivel;
  END IF;
  RAISE NOTICE 'OK(3): vínculo não-titular nasce em nenhum — só o balcão concede.';
END $$;

ROLLBACK;
