-- 004-contract-test-reconfirmacao.sql — prova o freio de contato reciclado
-- (003-reconfirmacao.sql).
--
-- O que NÃO é provado aqui, de propósito: que a resposta da SOFIA não vaza
-- nome/pacienteId para um contato a_reconfirmar — isso é forma de TypeScript
-- (ResolucaoIdentidade), não SQL. Ver tests/integration/reconfirmacao.test.ts.
BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- (1) fn_contato_confiavel — a regra, isolada.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT fn_contato_confiavel('ativo', now()) THEN
    RAISE EXCEPTION 'FALHA(1a): status ativo + verificado agora deveria ser confiável.';
  END IF;

  IF fn_contato_confiavel('ativo', now() - interval '6 months') THEN
    RAISE EXCEPTION 'FALHA(1b): verificação de 6 meses atrás deveria ter vencido.';
  END IF;

  IF fn_contato_confiavel('ativo', now() - interval '5 months' - interval '1 day') THEN
    RAISE EXCEPTION 'FALHA(1c): 1 dia além do limiar deveria ter vencido.';
  END IF;

  IF NOT fn_contato_confiavel('ativo', now() - interval '5 months' + interval '1 day') THEN
    RAISE EXCEPTION 'FALHA(1d): 1 dia dentro do limiar ainda deveria ser confiável.';
  END IF;

  IF fn_contato_confiavel('ativo', NULL) THEN
    RAISE EXCEPTION 'FALHA(1e): nunca verificado (NULL) não é "novo e confiável" — é desconhecido.';
  END IF;

  IF fn_contato_confiavel('a_reconfirmar', now()) THEN
    RAISE EXCEPTION 'FALHA(1f): status a_reconfirmar bloqueia mesmo com verificado_em recente.';
  END IF;

  IF fn_contato_confiavel('revogado', now()) THEN
    RAISE EXCEPTION 'FALHA(1g): status revogado nunca é confiável.';
  END IF;

  RAISE NOTICE 'OK(1): fn_contato_confiavel — status, NULL e limiar de 5 meses corretos.';
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- (2) escalonamentos aceita o novo gatilho e continua rejeitando lixo.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_clinica int;
  v_id1 bigint;
  v_id2 bigint;
  v_abertos int;
BEGIN
  SELECT id INTO v_clinica FROM clinicas ORDER BY id LIMIT 1;
  PERFORM set_config('app.clinica_id', v_clinica::text, true);

  v_id1 := abrir_escalonamento('+5511900000099-teste-reconf@c.us', 'reconfirmar_identidade', NULL);
  IF v_id1 IS NULL THEN
    RAISE EXCEPTION 'FALHA(2a): abrir_escalonamento recusou o gatilho reconfirmar_identidade.';
  END IF;

  -- anti-flood: segunda chamada no mesmo chat devolve o MESMO id, não cria outro.
  v_id2 := abrir_escalonamento('+5511900000099-teste-reconf@c.us', 'reconfirmar_identidade', NULL);
  IF v_id2 <> v_id1 THEN
    RAISE EXCEPTION 'FALHA(2b): segunda chamada deveria reusar o escalonamento aberto, criou outro.';
  END IF;

  SELECT count(*) INTO v_abertos FROM escalonamentos
   WHERE chat_id = '+5511900000099-teste-reconf@c.us' AND status = 'aberto';
  IF v_abertos <> 1 THEN
    RAISE EXCEPTION 'FALHA(2c): esperava 1 escalonamento aberto para o chat, achou %.', v_abertos;
  END IF;

  BEGIN
    PERFORM abrir_escalonamento('+5511900000098-teste-reconf@c.us', 'gatilho_inventado', NULL);
    RAISE EXCEPTION 'FALHA(2d): gatilho fora da lista deveria ter sido rejeitado pelo CHECK.';
  EXCEPTION WHEN check_violation THEN
    NULL; -- esperado
  END;

  RAISE NOTICE 'OK(2): reconfirmar_identidade aceito, anti-flood intacto, lixo continua rejeitado.';
END $$;

ROLLBACK;
