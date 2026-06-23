-- ============================================================================
-- 004-seed-e2e.sql — Seed de preços (Bella id 2) + E2E do ciclo financeiro.
-- PARTE 1: cadastra a tabela de preços (PERSISTENTE — fica p/ uso no app).
-- PARTE 2: E2E em BEGIN..ROLLBACK (nada do teste persiste; caixa é append-only).
--   Cada passo asserta com RAISE EXCEPTION. Se o batch der erro = E2E falhou.
-- Uso: runner _run-sql.mjs. Roda como superuser (bypassa RLS); filtros usam o GUC.
-- ============================================================================

-- ---------- PARTE 1: seed de preços (committed) ----------
INSERT INTO financeiro_precos (clinica_id, tipo_atendimento, valor, ativo) VALUES
  (2,'consulta',     200.00, true),
  (2,'retorno',      100.00, true),
  (2,'procedimento', 350.00, true),
  (2,'avaliacao',    150.00, true),
  (2,'limpeza',      250.00, true)
ON CONFLICT (clinica_id, tipo_atendimento)
DO UPDATE SET valor = EXCLUDED.valor, ativo = true, atualizado_em = NOW();

-- ---------- PARTE 2: E2E (rolled back) ----------
BEGIN;
DO $$
DECLARE
  v_pac CONSTANT INT := 7;          -- paciente real da Bella
  v_preco NUMERIC; v_cob INT;
  base_receber NUMERIC; base_caixa NUMERIC; base_fat NUMERIC; base_inad NUMERIC;
  d NUMERIC; v_err BOOLEAN;
BEGIN
  PERFORM set_config('app.clinica_id','2', true);

  -- preço vigente de 'procedimento' = 350 (replicando precoVigente)
  SELECT valor INTO v_preco FROM financeiro_precos
    WHERE clinica_id=2 AND tipo_atendimento='procedimento' AND ativo=true;
  IF v_preco <> 350.00 THEN RAISE EXCEPTION 'E2E: preço vigente esperado 350, veio %', v_preco; END IF;

  -- baselines (antes de qualquer movimento)
  SELECT COALESCE(SUM(valor),0) INTO base_receber FROM financeiro_cobrancas
    WHERE clinica_id=2 AND status='aberta';
  SELECT COALESCE(SUM(valor) FILTER (WHERE tipo='receita'),0)
       - COALESCE(SUM(valor) FILTER (WHERE tipo='despesa'),0) INTO base_caixa
    FROM financeiro_lancamentos WHERE clinica_id=2 AND criado_em::date = CURRENT_DATE;
  SELECT COALESCE(SUM(valor),0) INTO base_fat FROM financeiro_lancamentos
    WHERE clinica_id=2 AND tipo='receita'
      AND date_trunc('month',criado_em)=date_trunc('month',CURRENT_DATE);
  SELECT COALESCE(SUM(valor),0) INTO base_inad FROM financeiro_cobrancas
    WHERE clinica_id=2 AND status='aberta' AND vencimento < CURRENT_DATE;

  -- 1) cobrança automática nasce 'aberta' com o preço vigente, venc D0
  INSERT INTO financeiro_cobrancas
    (clinica_id, paciente_id, tipo_atendimento, valor, vencimento, status)
  VALUES (2, v_pac, 'procedimento', v_preco, CURRENT_DATE, 'aberta')
  RETURNING id INTO v_cob;

  SELECT COALESCE(SUM(valor),0) - base_receber INTO d FROM financeiro_cobrancas
    WHERE clinica_id=2 AND status='aberta';
  IF d <> 350.00 THEN RAISE EXCEPTION 'E2E 1: a-receber deveria subir 350, subiu %', d; END IF;

  -- 2) pagamento: lançamento receita + cobrança 'paga' (replicando registrarPagamento)
  INSERT INTO financeiro_lancamentos
    (clinica_id, tipo, categoria, valor, descricao, cobranca_id, forma_pagamento)
  VALUES (2,'receita','atendimento', v_preco, 'Pagamento da cobrança #'||v_cob, v_cob, 'pix');
  UPDATE financeiro_cobrancas
     SET status='paga', forma_pagamento='pix', pago_em=NOW(), atualizado_em=NOW()
   WHERE id=v_cob;

  -- caixa do dia e faturamento do mês sobem 350
  SELECT (COALESCE(SUM(valor) FILTER (WHERE tipo='receita'),0)
        - COALESCE(SUM(valor) FILTER (WHERE tipo='despesa'),0)) - base_caixa INTO d
    FROM financeiro_lancamentos WHERE clinica_id=2 AND criado_em::date=CURRENT_DATE;
  IF d <> 350.00 THEN RAISE EXCEPTION 'E2E 2a: caixa do dia deveria subir 350, subiu %', d; END IF;
  SELECT COALESCE(SUM(valor),0) - base_fat INTO d FROM financeiro_lancamentos
    WHERE clinica_id=2 AND tipo='receita'
      AND date_trunc('month',criado_em)=date_trunc('month',CURRENT_DATE);
  IF d <> 350.00 THEN RAISE EXCEPTION 'E2E 2b: faturamento do mês deveria subir 350, subiu %', d; END IF;

  -- 3) cobrança agora está 'paga' (não conta mais em a-receber)
  SELECT COALESCE(SUM(valor),0) - base_receber INTO d FROM financeiro_cobrancas
    WHERE clinica_id=2 AND status='aberta';
  IF d <> 0 THEN RAISE EXCEPTION 'E2E 3: cobrança paga deveria sair de a-receber (delta %)', d; END IF;

  -- 4) idempotência: 2º pagamento da mesma cobrança colide (uq_lancamento_por_cobranca)
  v_err := false;
  BEGIN
    INSERT INTO financeiro_lancamentos (clinica_id, tipo, valor, cobranca_id, forma_pagamento)
    VALUES (2,'receita', v_preco, v_cob, 'pix');
  EXCEPTION WHEN unique_violation THEN v_err := true; END;
  IF NOT v_err THEN RAISE EXCEPTION 'E2E 4: 2º pagamento deveria ser bloqueado (idempotência)'; END IF;

  -- 5) inadimplência: cobrança aberta com vencimento vencido entra no total vencido
  INSERT INTO financeiro_cobrancas
    (clinica_id, paciente_id, tipo_atendimento, valor, vencimento, status)
  VALUES (2, v_pac, 'consulta', 200.00, CURRENT_DATE - 10, 'aberta');
  SELECT COALESCE(SUM(valor),0) - base_inad INTO d FROM financeiro_cobrancas
    WHERE clinica_id=2 AND status='aberta' AND vencimento < CURRENT_DATE;
  IF d <> 200.00 THEN RAISE EXCEPTION 'E2E 5: inadimplência deveria subir 200, subiu %', d; END IF;

  RAISE NOTICE 'E2E OK: cobrança 350 → paga → caixa+350, fat+350, idempotência ok, inadimplência+200';
END$$;
ROLLBACK;

-- ---------- Confirmação (lê o estado COMMITTED: só os preços do seed) ----------
SET app.clinica_id='2';
SELECT 'E2E PASSED' AS e2e, tipo_atendimento, valor::float8 AS preco
  FROM financeiro_precos WHERE clinica_id=2 ORDER BY tipo_atendimento;
