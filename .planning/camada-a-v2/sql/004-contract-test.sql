-- ============================================================================
-- 004-contract-test.sql — prova as garantias da Camada A v2 (itens 1, 3 e 4).
-- Cada falha = RAISE EXCEPTION. BEGIN ... ROLLBACK, não deixa lixo.
-- Pré-requisito: base + camada-a/001..004 + reativacao/007 + v2/001..003.
-- Clínica de teste = 2.
-- ============================================================================
BEGIN;
SET LOCAL app.clinica_id = '2';

DO $$
DECLARE
  v_pac int; v_pac2 int; v_pac3 int; v_cont int; v_agend int;
  v_prof int; v_prof2 int; v_serv int; v_serv2 int;
  v_esc bigint; v_esc2 bigint; v_of bigint; v_of2 bigint;
  v_le1 int; v_le2 int; v_le3 int;
  v_g jsonb; v_payload jsonb; v_n int; v_prazo timestamptz; frase text;
BEGIN
  -- ==========================================================================
  -- (1) TRIAGEM — frase clínica escala; frase operacional passa.
  -- ==========================================================================
  FOREACH frase IN ARRAY ARRAY[
    'tá doendo desde ontem',
    'posso tomar antibiótico?',
    'esse caroço é normal?',
    'minha gengiva está sangrando muito',
    'estou com febre depois da cirurgia',
    'tomei dipirona e não passou'
  ] LOOP
    IF fn_triagem_clinica(frase) IS NULL THEN
      RAISE EXCEPTION 'FALHA(1) guardrail furado: "%" passou pela triagem', frase;
    END IF;
  END LOOP;

  FOREACH frase IN ARRAY ARRAY[
    'posso remarcar?', 'que horas é minha consulta?', 'quanto custa?',
    'onde fica a clínica?', 'confirmo sim', 'aceita meu convênio?'
  ] LOOP
    IF fn_triagem_clinica(frase) IS NOT NULL THEN
      RAISE EXCEPTION 'FALHA(1b) falso positivo: "%" escalou como %', frase, fn_triagem_clinica(frase);
    END IF;
  END LOOP;

  -- acento não pode ser rota de fuga: com e sem acento dão o mesmo veredito
  IF fn_triagem_clinica('está doendo') IS DISTINCT FROM fn_triagem_clinica('esta doendo') THEN
    RAISE EXCEPTION 'FALHA(1c): normalização de acento não está valendo';
  END IF;

  -- ==========================================================================
  -- (2) PORTA DE MÃO ÚNICA + (3) anti-flood
  -- ==========================================================================
  IF fn_chat_bloqueado('5548911110000@c.us') THEN
    RAISE EXCEPTION 'FALHA(2): chat sem escalonamento não deveria estar bloqueado';
  END IF;

  v_g := fn_guardrail('5548911110000@c.us', 'estou com muita dor');
  IF NOT (v_g->>'bloqueado')::boolean THEN
    RAISE EXCEPTION 'FALHA(2b): guardrail não bloqueou frase clínica -> %', v_g;
  END IF;
  v_esc := (v_g->>'escalonamento_id')::bigint;

  IF NOT fn_chat_bloqueado('5548911110000@c.us') THEN
    RAISE EXCEPTION 'FALHA(2c): chat com escalonamento aberto deveria estar bloqueado';
  END IF;

  -- porta de mão única: mesmo uma frase INOCENTE não volta a passar
  v_g := fn_guardrail('5548911110000@c.us', 'posso remarcar?');
  IF NOT (v_g->>'bloqueado')::boolean THEN
    RAISE EXCEPTION 'FALHA(2d) PORTA DE MAO UNICA: bot voltou a responder chat escalado';
  END IF;

  -- anti-flood: nada disso criou um segundo chamado
  SELECT count(*) INTO v_n FROM escalonamentos WHERE chat_id = '5548911110000@c.us';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FALHA(3) anti-flood: % escalonamentos para o mesmo chat', v_n;
  END IF;

  -- resolvido reabre o caminho
  UPDATE escalonamentos SET status = 'resolvido', resolvido_em = NOW() WHERE id = v_esc;
  IF fn_chat_bloqueado('5548911110000@c.us') THEN
    RAISE EXCEPTION 'FALHA(2e): chat resolvido deveria destravar';
  END IF;

  -- ==========================================================================
  -- (4) SLA
  -- ==========================================================================
  UPDATE clinicas SET sla_escalada_min = 45 WHERE id = 2;
  v_esc2 := abrir_escalonamento('5548922220000@c.us', 'duvida_clinica', 'posso tomar remédio?');
  SELECT prazo_em INTO v_prazo FROM escalonamentos WHERE id = v_esc2;
  IF v_prazo IS NULL THEN
    RAISE EXCEPTION 'FALHA(4): trigger não preencheu prazo_em';
  END IF;
  SELECT EXTRACT(epoch FROM (prazo_em - criado_em))::int / 60 INTO v_n
    FROM escalonamentos WHERE id = v_esc2;
  IF v_n <> 45 THEN
    RAISE EXCEPTION 'FALHA(4b): prazo deveria ser criado_em + 45min, veio % min', v_n;
  END IF;

  -- item vencido aparece como atrasado na fila
  UPDATE escalonamentos SET prazo_em = NOW() - interval '1 min' WHERE id = v_esc2;
  IF NOT EXISTS (SELECT 1 FROM v_fila_escalonamento WHERE id = v_esc2 AND atrasado) THEN
    RAISE EXCEPTION 'FALHA(4c): escalonamento vencido não apareceu como atrasado';
  END IF;

  -- ==========================================================================
  -- fixtures da fila reversa
  -- ==========================================================================
  INSERT INTO servicos (clinica_id, nome, duracao_min) VALUES (2, '[T] Ortodontia', 30) RETURNING id INTO v_serv;
  INSERT INTO servicos (clinica_id, nome, duracao_min) VALUES (2, '[T] Clareamento', 30) RETURNING id INTO v_serv2;
  INSERT INTO profissionais (clinica_id, nome) VALUES (2, '[T] Dra Ana') RETURNING id INTO v_prof;
  INSERT INTO profissionais (clinica_id, nome) VALUES (2, '[T] Dr Bruno') RETURNING id INTO v_prof2;

  INSERT INTO pacientes (clinica_id, nome_completo, data_nascimento)
    VALUES (2, '[T] Titular da vaga', '1990-01-01') RETURNING id INTO v_pac;
  INSERT INTO pacientes (clinica_id, nome_completo, data_nascimento)
    VALUES (2, '[T] Primeiro da fila', '1991-01-01') RETURNING id INTO v_pac2;
  INSERT INTO pacientes (clinica_id, nome_completo, data_nascimento)
    VALUES (2, '[T] Segundo da fila', '1992-01-01') RETURNING id INTO v_pac3;

  -- vaga: ortodontia, Dra Ana, às 10h (manhã), amanhã
  INSERT INTO agendamentos_sofia_demo
    (clinica_id, paciente_id, telefone, chat_id, servico, servico_id, profissional_id,
     data_agendamento, hora_agendamento, inicio, fim, status)
  VALUES (2, v_pac, '+5548999990000', '5548999990001@c.us', '[T] Ortodontia', v_serv, v_prof,
          (NOW() + interval '1 day')::date, '10:00',
          date_trunc('day', NOW() + interval '1 day') + interval '10 hours',
          date_trunc('day', NOW() + interval '1 day') + interval '10 hours 30 min', 'agendada')
  RETURNING id INTO v_agend;

  -- fila: [1] incompatível (clareamento), [2] compatível, [3] compatível mas depois
  INSERT INTO lista_espera (clinica_id, paciente_id, servico_id, disponibilidade)
    VALUES (2, v_pac2, v_serv2, 'qualquer') RETURNING id INTO v_le1;      -- serviço errado
  INSERT INTO lista_espera (clinica_id, paciente_id, servico_id, disponibilidade, criado_em)
    VALUES (2, v_pac2, v_serv, 'manha', NOW() - interval '2 days') RETURNING id INTO v_le2;
  INSERT INTO lista_espera (clinica_id, paciente_id, servico_id, disponibilidade, profissional_id, criado_em)
    VALUES (2, v_pac3, v_serv, 'qualquer', v_prof2, NOW() - interval '3 days') RETURNING id INTO v_le3;
                                                              -- ^ profissional errado, e é o mais antigo

  -- ==========================================================================
  -- (7) POLÍTICA — default avisa_recepcao NÃO dispara oferta
  -- ==========================================================================
  IF fn_liberar_vaga(v_agend) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA(7): politica_vaga=avisa_recepcao não deveria criar oferta';
  END IF;

  UPDATE clinicas SET politica_vaga = 'automatica' WHERE id = 2;

  -- ==========================================================================
  -- (5) COMPATIBILIDADE + (6) CASCATA
  -- ==========================================================================
  v_of := fn_liberar_vaga(v_agend);
  IF v_of IS NULL THEN
    RAISE EXCEPTION 'FALHA(5): havia candidato compatível e nenhuma oferta saiu';
  END IF;
  SELECT lista_espera_id INTO v_n FROM ofertas_vaga WHERE id = v_of;
  IF v_n <> v_le2 THEN
    RAISE EXCEPTION 'FALHA(5b) compatibilidade: ofertou para % (esperado %, o único compatível)', v_n, v_le2;
  END IF;

  -- cascata: uma vaga, uma oferta pendente. Segunda chamada não cria outra.
  IF fn_proxima_oferta(v_agend) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA(6) CASCATA: criou segunda oferta com uma pendente (isso é broadcast)';
  END IF;

  -- a invariante é do BANCO, não da função: insert direto também tem que quebrar
  BEGIN
    INSERT INTO ofertas_vaga (clinica_id, agendamento_id, lista_espera_id, expira_em)
      VALUES (2, v_agend, v_le3, NOW() + interval '15 min');
    RAISE EXCEPTION 'FALHA(6b): uq_oferta_pendente_por_vaga deixou passar 2ª oferta pendente';
  EXCEPTION WHEN unique_violation THEN NULL;  -- esperado
  END;

  -- timeout passa ao próximo — e como não há outro compatível, a fila esgota
  UPDATE ofertas_vaga SET expira_em = NOW() - interval '1 min' WHERE id = v_of;
  PERFORM fn_expirar_ofertas();
  IF (SELECT resposta FROM ofertas_vaga WHERE id = v_of) <> 'timeout' THEN
    RAISE EXCEPTION 'FALHA(6c): oferta vencida não virou timeout';
  END IF;
  SELECT count(*) INTO v_n FROM ofertas_vaga WHERE agendamento_id = v_agend AND resposta IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FALHA(6d) FILA_ESGOTADA: sobrou oferta pendente sem candidato compatível';
  END IF;

  -- ==========================================================================
  -- (8) PAYLOAD DA OFERTA — mesmo contrato de 4 chaves, e para o CANDIDATO
  -- ==========================================================================
  v_payload := fn_payload_oferta(v_of);
  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'FALHA(8): payload da oferta veio nulo';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(v_payload)) <> 4
     OR NOT (v_payload ?& array['nome','data_hora','unidade','profissional']) THEN
    RAISE EXCEPTION 'FALHA(8b): payload fora do contrato -> %', v_payload;
  END IF;
  IF v_payload ?| array['procedimento','servico','gravidade','diagnostico'] THEN
    RAISE EXCEPTION 'FALHA(8c) VAZAMENTO: oferta carrega campo clínico -> %', v_payload;
  END IF;
  -- o nome é do candidato, não de quem desmarcou: mandar o nome do outro seria
  -- contar a um terceiro quem tinha consulta marcada.
  IF v_payload->>'nome' <> '[T] Primeiro da fila' THEN
    RAISE EXCEPTION 'FALHA(8d): payload endereçado a "%" (esperado o candidato)', v_payload->>'nome';
  END IF;

  RAISE NOTICE 'OK: Camada A v2 — 8 garantias provadas.';
END $$;

ROLLBACK;
