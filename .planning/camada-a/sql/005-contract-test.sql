-- ============================================================================
-- 005-contract-test.sql — prova as GARANTIAS da Camada A. Cada falha = EXCEPTION.
-- Não deixa lixo: tudo dentro de BEGIN ... ROLLBACK.
-- Pré-requisito: 001..004 aplicados. Clínica de teste = 2 (Bella).
-- Padrão herdado de estoque/003-contract-test.sql.
-- ============================================================================
BEGIN;
SET LOCAL app.clinica_id = '2';

DO $$
DECLARE
  v_pac int; v_cont int; v_agend int; v_prof int;
  v_payload jsonb; v_motivo text; v_status text; v_tmpl int; v_n int;
BEGIN
  -- fixtures -----------------------------------------------------------------
  INSERT INTO pacientes (clinica_id, nome_completo, data_nascimento)
    VALUES (2, '[TESTE] Camada A', '1990-01-01') RETURNING id INTO v_pac;
  INSERT INTO contatos_whatsapp (clinica_id, chat_id, telefone, origem, estado_lead)
    VALUES (2, '5548999990000@c.us', '+5548999990000', 'instagram', 'novo') RETURNING id INTO v_cont;
  INSERT INTO paciente_contato (clinica_id, paciente_id, contato_id, titular)
    VALUES (2, v_pac, v_cont, true);
  SELECT id INTO v_prof FROM profissionais WHERE clinica_id = 2 LIMIT 1;

  INSERT INTO agendamentos_sofia_demo
    (clinica_id, paciente_id, contato_origem_id, telefone, chat_id, servico,
     data_agendamento, hora_agendamento, inicio, fim, profissional_id, status)
  VALUES (2, v_pac, v_cont, '+5548999990000', '5548999990000@c.us', 'Clareamento',
          (NOW() + interval '2 days')::date, '10:00', NOW() + interval '2 days',
          NOW() + interval '2 days 30 min', v_prof, 'agendada')
  RETURNING id INTO v_agend;

  -- (1) CATRACA deixa passar o registro íntegro -------------------------------
  v_motivo := fn_motivo_barrado(v_agend);
  IF v_motivo IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA(1) catraca: registro válido foi barrado por %', v_motivo;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM v_fila_disparo WHERE agendamento_id = v_agend) THEN
    RAISE EXCEPTION 'FALHA(1b): agendamento apto não apareceu em v_fila_disparo';
  END IF;

  -- (2) CATRACA barra telefone inválido — e diz por quê ------------------------
  UPDATE contatos_whatsapp SET telefone = '11 9999', chat_id = '119999' WHERE id = v_cont;
  IF fn_motivo_barrado(v_agend) <> 'sem_contato_valido' THEN
    RAISE EXCEPTION 'FALHA(2): telefone invalido deveria barrar, veio %', fn_motivo_barrado(v_agend);
  END IF;
  IF EXISTS (SELECT 1 FROM v_fila_disparo WHERE agendamento_id = v_agend) THEN
    RAISE EXCEPTION 'FALHA(2b): registro barrado vazou para v_fila_disparo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM v_barrados_validacao WHERE agendamento_id = v_agend) THEN
    RAISE EXCEPTION 'FALHA(2c): registro barrado não apareceu em v_barrados_validacao';
  END IF;
  UPDATE contatos_whatsapp SET telefone = '+5548999990000', chat_id = '5548999990000@c.us' WHERE id = v_cont;

  -- (3) horário no passado também barra (tese 2: catraca, não fiscal) ----------
  UPDATE agendamentos_sofia_demo SET inicio = NOW() - interval '1 hour' WHERE id = v_agend;
  IF fn_motivo_barrado(v_agend) <> 'horario_no_passado' THEN
    RAISE EXCEPTION 'FALHA(3): agendamento no passado deveria barrar';
  END IF;
  UPDATE agendamentos_sofia_demo SET inicio = NOW() + interval '2 days' WHERE id = v_agend;

  -- (4) ENVELOPE LACRADO (§4.3) — severidade alta -----------------------------
  --     nenhum campo clínico pode ter caminho até a mensagem.
  v_payload := fn_payload_lembrete(v_agend);
  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'FALHA(4): payload nulo para agendamento apto';
  END IF;
  IF v_payload ?| array['procedimento','servico','servico_id','gravidade','diagnostico','observacoes'] THEN
    RAISE EXCEPTION 'FALHA(4) VAZAMENTO: payload carrega campo clínico -> %', v_payload;
  END IF;
  IF NOT (v_payload ?& array['nome','data_hora','unidade','profissional']) THEN
    RAISE EXCEPTION 'FALHA(4b): payload incompleto -> %', v_payload;
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(v_payload)) <> 4 THEN
    RAISE EXCEPTION 'FALHA(4c): payload tem chave além das 4 do contrato -> %', v_payload;
  END IF;

  -- (5) ESCALADA automática em 2 falhas (§12.3) -------------------------------
  UPDATE agendamentos_sofia_demo SET falhas_classificacao = 1 WHERE id = v_agend;
  SELECT status INTO v_status FROM agendamentos_sofia_demo WHERE id = v_agend;
  IF v_status = 'escalado_humano' THEN
    RAISE EXCEPTION 'FALHA(5): escalou com 1 falha, o limiar é 2';
  END IF;
  UPDATE agendamentos_sofia_demo SET falhas_classificacao = 2 WHERE id = v_agend;
  SELECT status INTO v_status FROM agendamentos_sofia_demo WHERE id = v_agend;
  IF v_status <> 'escalado_humano' THEN
    RAISE EXCEPTION 'FALHA(5b): 2 falhas deveriam escalar, status ficou %', v_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM eventos_agendamento
                  WHERE agendamento_id = v_agend AND tipo = 'escalado') THEN
    RAISE EXCEPTION 'FALHA(5c): escalada não gerou evento no livro-razão';
  END IF;

  -- (6) estados novos: CHECK **e** máquina de transições ----------------------
  --     Estar no CHECK não basta — bot-agendamento/002 impõe fn_transicao_valida
  --     por trigger. Este bloco só passou a existir depois de a aplicação em
  --     produção revelar que os três estados eram inalcançáveis.
  IF fn_transicao_valida('agendada','recusada')          IS NOT TRUE THEN RAISE EXCEPTION 'FALHA(6a): agendada -> recusada bloqueada'; END IF;
  IF fn_transicao_valida('agendada','sem_resposta')      IS NOT TRUE THEN RAISE EXCEPTION 'FALHA(6b): agendada -> sem_resposta bloqueada'; END IF;
  IF fn_transicao_valida('sem_resposta','confirmada')    IS NOT TRUE THEN RAISE EXCEPTION 'FALHA(6c): silêncio deveria admitir resposta tardia'; END IF;
  -- escalar sempre pode: o bot desistir não pode ser bloqueado por regra de fluxo
  IF fn_transicao_valida('confirmada','escalado_humano') IS NOT TRUE THEN RAISE EXCEPTION 'FALHA(6d): escalada bloqueada a partir de confirmada'; END IF;
  -- e escalado_humano NÃO pode ser beco sem saída
  IF fn_transicao_valida('escalado_humano','cancelada')  IS NOT TRUE THEN RAISE EXCEPTION 'FALHA(6e): escalado_humano virou beco sem saída'; END IF;
  -- terminais continuam terminais
  IF fn_transicao_valida('realizada','recusada')         IS NOT FALSE THEN RAISE EXCEPTION 'FALHA(6f): terminal deixou de ser terminal'; END IF;

  -- e o caminho real, pelo trigger (não só pela função)
  UPDATE agendamentos_sofia_demo SET status = 'agendada'     WHERE id = v_agend;
  UPDATE agendamentos_sofia_demo SET status = 'sem_resposta' WHERE id = v_agend;
  UPDATE agendamentos_sofia_demo SET status = 'recusada'     WHERE id = v_agend;

  -- (7) TEMPLATE: só uma versão ativa por chave -------------------------------
  INSERT INTO templates (clinica_id, chave, versao, corpo)
    VALUES (2, '[TESTE] lembrete_d1', 3, 'Confirma?') RETURNING id INTO v_tmpl;
  BEGIN
    INSERT INTO templates (clinica_id, chave, versao, corpo)
      VALUES (2, '[TESTE] lembrete_d1', 4, 'outro');
    RAISE EXCEPTION 'FALHA(7): duas versoes ativas da mesma chave deveriam violar uq_template_ativo';
  EXCEPTION WHEN unique_violation THEN NULL;  -- esperado
  END;

  -- (8) TESE 4: a resposta é atribuída ao template que a antecedeu -------------
  INSERT INTO mensagens_bot (clinica_id, contato_id, direcao, conteudo, template_id, ocorrido_em)
    VALUES (2, v_cont, 'saida', 'Confirma?', v_tmpl, NOW() - interval '10 min');
  INSERT INTO mensagens_bot (clinica_id, contato_id, direcao, conteudo, intencao, ocorrido_em)
    VALUES (2, v_cont, 'entrada', 'quanto custa?', 'duvida_preco', NOW() - interval '5 min');
  SELECT respostas INTO v_n FROM v_intencao_por_template
   WHERE chave = '[TESTE] lembrete_d1' AND versao = 3 AND intencao = 'duvida_preco';
  IF COALESCE(v_n, 0) <> 1 THEN
    RAISE EXCEPTION 'FALHA(8): duvida_preco nao foi atribuida ao template v3 (veio %)', v_n;
  END IF;

  -- (9) §10 CUSTO: saída sem entrada nas 24h anteriores é cobrada -------------
  INSERT INTO mensagens_bot (clinica_id, contato_id, direcao, conteudo, ocorrido_em)
    VALUES (2, v_cont, 'saida', 'H-1', NOW() - interval '40 hours');
  SELECT fora_da_janela_cobradas INTO v_n FROM v_custo_disparo
   WHERE clinica_id = 2 AND mes = date_trunc('month', NOW() - interval '40 hours');
  IF COALESCE(v_n, 0) < 1 THEN
    RAISE EXCEPTION 'FALHA(9): saida fora da janela de 24h nao foi contada como cobrada';
  END IF;

  -- (10) taxonomia fechada: etiqueta fora do §8 não entra ---------------------
  BEGIN
    INSERT INTO mensagens_bot (clinica_id, contato_id, direcao, intencao)
      VALUES (2, v_cont, 'entrada', 'inventada');
    RAISE EXCEPTION 'FALHA(10): intencao fora da taxonomia deveria ser rejeitada pelo enum';
  EXCEPTION WHEN invalid_text_representation THEN NULL;  -- esperado
  END;

  RAISE NOTICE 'OK: Camada A — 10 garantias provadas.';
END $$;

-- (11) TESE 1 — o papel de marketing NÃO alcança dado de saúde.
SET LOCAL ROLE app_marketing;
DO $$
BEGIN
  PERFORM 1 FROM pacientes LIMIT 1;
  RAISE EXCEPTION 'FALHA(11) TESE 1: app_marketing conseguiu ler pacientes';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'OK(11): app_marketing barrado em pacientes';
END $$;
RESET ROLE;

ROLLBACK;
