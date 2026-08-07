-- failure-sim.sql — injeção de falhas nos módulos Estoque+Prontuário (Bella=2).
-- Coleta resultado de cada probe em _res e devolve; BEGIN..ROLLBACK (não persiste).
BEGIN;
SET LOCAL app.clinica_id = '2';
CREATE TEMP TABLE _res(sev text, probe text, resultado text) ON COMMIT DROP;

DO $$
DECLARE
  v_prod int; v_lote int; v_prod1 int; mov_sum numeric; lote_sum numeric;
  ok boolean; v_txt text;
BEGIN
  -- ---------------------------------------------------------------------------
  -- P1 — Invariante de reconciliação NÃO é forçada pelo banco (só pela app).
  -- ---------------------------------------------------------------------------
  INSERT INTO produtos(clinica_id,nome,unidade) VALUES(2,'_fs_p1','un') RETURNING id INTO v_prod;
  INSERT INTO lotes(clinica_id,produto_id,quantidade,custo_unitario)
    VALUES(2,v_prod,10,1) RETURNING id INTO v_lote;
  INSERT INTO movimentacoes_estoque(clinica_id,produto_id,lote_id,tipo,motivo,quantidade,custo_unitario)
    VALUES(2,v_prod,v_lote,'entrada','compra',10,1);
  -- escritor "rogue": registra saída SEM baixar o lote (quebra a invariante)
  INSERT INTO movimentacoes_estoque(clinica_id,produto_id,lote_id,tipo,motivo,quantidade,custo_unitario)
    VALUES(2,v_prod,v_lote,'saida','consumo',-3,1);
  SELECT SUM(quantidade) INTO mov_sum  FROM movimentacoes_estoque WHERE produto_id=v_prod;
  SELECT SUM(quantidade) INTO lote_sum FROM lotes               WHERE produto_id=v_prod;
  INSERT INTO _res VALUES('🟡',
    'P1 invariante SUM(mov)=SUM(lotes) é só da app (DB não força)',
    CASE WHEN mov_sum<>lote_sum
      THEN 'CONFIRMADO: banco aceitou divergência (mov='||mov_sum||' vs lotes='||lote_sum||')'
      ELSE 'banco bloqueou (inesperado)' END);

  -- ---------------------------------------------------------------------------
  -- P5 — Divergência (C3) PRESERVA a invariante (baixa parcial com saldo negativo).
  -- ---------------------------------------------------------------------------
  INSERT INTO produtos(clinica_id,nome,unidade) VALUES(2,'_fs_p5','un') RETURNING id INTO v_prod;
  INSERT INTO lotes(clinica_id,produto_id,quantidade,custo_unitario)
    VALUES(2,v_prod,5,2) RETURNING id INTO v_lote;
  INSERT INTO movimentacoes_estoque(clinica_id,produto_id,lote_id,tipo,motivo,quantidade,custo_unitario)
    VALUES(2,v_prod,v_lote,'entrada','compra',5,2);
  -- consome 8 do jeito da app: 5 do lote + 3 divergência
  UPDATE lotes SET quantidade=quantidade-5 WHERE id=v_lote;
  INSERT INTO movimentacoes_estoque(clinica_id,produto_id,lote_id,tipo,motivo,quantidade,custo_unitario)
    VALUES(2,v_prod,v_lote,'saida','consumo',-5,2);
  UPDATE lotes SET quantidade=quantidade-3 WHERE id=v_lote;
  INSERT INTO movimentacoes_estoque(clinica_id,produto_id,lote_id,tipo,motivo,quantidade,custo_unitario)
    VALUES(2,v_prod,v_lote,'saida','divergencia',-3,2);
  SELECT SUM(quantidade) INTO mov_sum  FROM movimentacoes_estoque WHERE produto_id=v_prod;
  SELECT SUM(quantidade) INTO lote_sum FROM lotes               WHERE produto_id=v_prod;
  INSERT INTO _res VALUES('✅',
    'P5 C3: divergência mantém invariante e não trava',
    CASE WHEN mov_sum=lote_sum AND lote_sum=-3
      THEN 'OK: mov=lotes='||lote_sum||' (saldo negativo coerente)'
      ELSE 'FALHA: mov='||mov_sum||' lotes='||lote_sum END);

  -- ---------------------------------------------------------------------------
  -- P2 — Trava M2 (reconsumo): predicado que o repo usa antes de baixar.
  -- ---------------------------------------------------------------------------
  -- simula baixa anterior do MESMO agendamento (10) por outra entrada (4)
  INSERT INTO movimentacoes_estoque(clinica_id,produto_id,lote_id,tipo,motivo,quantidade,
                                    custo_unitario,agendamento_id,entrada_prontuario_id)
    VALUES(2,v_prod,v_lote,'saida','consumo',-1,2,10,4);
  SELECT EXISTS(SELECT 1 FROM movimentacoes_estoque
                 WHERE clinica_id=2 AND agendamento_id=10 AND tipo='saida'
                   AND entrada_prontuario_id IS DISTINCT FROM 999999) INTO ok;
  INSERT INTO _res VALUES('✅',
    'P2 trava M2 reconsumo por agendamento',
    CASE WHEN ok THEN 'OK: 2ª baixa do mesmo agendamento seria pulada' ELSE 'FALHA: guard não detectou' END);

  -- ---------------------------------------------------------------------------
  -- P4 — CHECK estoque_minimo >= 0.
  -- ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO produtos(clinica_id,nome,unidade,estoque_minimo) VALUES(2,'_fs_p4','un',-5);
    v_txt:='DB PERMITIU negativo (falha)';
  EXCEPTION WHEN check_violation THEN v_txt:='BLOQUEADO por chk_estoque_minimo_nao_neg';
  END;
  INSERT INTO _res VALUES('✅','P4 CHECK estoque_minimo>=0', v_txt);

  -- ---------------------------------------------------------------------------
  -- P3 — Cross-tenant: BOM da clínica 2 referenciando produto da clínica 1?
  --      (FK valida existência ignorando RLS — possível ponteiro cross-tenant.)
  -- ---------------------------------------------------------------------------
  INSERT INTO produtos(clinica_id,nome,unidade) VALUES(1,'_fs_p3_clinica1','un') RETURNING id INTO v_prod1;
  EXECUTE 'SET LOCAL ROLE app_painel';
  PERFORM set_config('app.clinica_id','2',true);
  BEGIN
    INSERT INTO procedimento_materiais(clinica_id,tipo_atendimento,produto_id,quantidade)
      VALUES(2,'procedimento',v_prod1,1);
    ok := true;
  EXCEPTION WHEN others THEN ok := false; v_txt := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  INSERT INTO _res VALUES(CASE WHEN ok THEN '🟡' ELSE '✅' END,
    'P3 BOM cross-tenant (FK não é tenant-scoped)',
    CASE WHEN ok
      THEN 'CONFIRMADO: app_painel(clínica2) criou BOM apontando p/ produto da clínica1 (inerte na leitura por JOIN+RLS, mas ponteiro cruzado existe)'
      ELSE 'bloqueado: '||v_txt END);
END$$;

SELECT sev AS "sev", probe AS "probe", resultado AS "resultado" FROM _res ORDER BY probe;
ROLLBACK;
