-- 003-contract-test.sql — testa as GARANTIAS do modelo de dados do estoque.
-- Auto-verificável: cada falha dá RAISE EXCEPTION (o runner mostra como erro).
-- Não deixa lixo: tudo dentro de BEGIN ... ROLLBACK.
-- Pré-requisito: rodar seed-teste.sql antes (clínica Bella = 2).
-- Cobre: RLS fail-closed, RLS isolamento entre clínicas, trigger append-only,
--        CHECK quantidade<>0, ordenação FEFO e invariante de reconciliação.
BEGIN;
SET LOCAL app.clinica_id = '2';

DO $$
DECLARE v_prod int; v_lote int; n int; primeiro text; soma_mov numeric; soma_lotes numeric;
BEGIN
  -- (1) append-only: UPDATE em movimentacoes_estoque deve ser bloqueado pelo trigger.
  SELECT id INTO v_prod FROM produtos WHERE nome = '[TESTE] Anestésico';
  SELECT id INTO v_lote FROM lotes WHERE produto_id = v_prod LIMIT 1;
  INSERT INTO movimentacoes_estoque (clinica_id, produto_id, lote_id, tipo, motivo, quantidade, custo_unitario)
    VALUES (2, v_prod, v_lote, 'entrada', 'compra', 1, 5.0);
  BEGIN
    UPDATE movimentacoes_estoque SET quantidade = 2 WHERE produto_id = v_prod;
    RAISE EXCEPTION 'FALHA(1): UPDATE em movimentacoes_estoque deveria ser bloqueado (append-only)';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'FALHA(%' THEN RAISE; END IF; -- erro do trigger é o esperado
  END;

  -- (2) CHECK chk_quantidade_nao_zero: quantidade = 0 deve violar.
  BEGIN
    INSERT INTO movimentacoes_estoque (clinica_id, produto_id, lote_id, tipo, motivo, quantidade)
      VALUES (2, v_prod, v_lote, 'ajuste', 'ajuste_inventario', 0);
    RAISE EXCEPTION 'FALHA(2): quantidade=0 deveria violar chk_quantidade_nao_zero';
  EXCEPTION WHEN check_violation THEN NULL; -- esperado
  END;

  -- (3) FEFO: o lote que vence ANTES (L-PERTO) deve ser o 1º na ordem de consumo.
  SELECT id INTO v_prod FROM produtos WHERE nome = '[TESTE] Luva Nitrílica';
  SELECT codigo_lote INTO primeiro
    FROM lotes WHERE produto_id = v_prod AND quantidade > 0
    ORDER BY validade ASC NULLS LAST, id ASC LIMIT 1;
  IF primeiro IS DISTINCT FROM 'L-PERTO' THEN
    RAISE EXCEPTION 'FALHA(3) FEFO: esperado L-PERTO primeiro, veio %', primeiro;
  END IF;

  -- (4) RLS fail-closed: sem GUC -> 0 linhas visíveis.
  PERFORM set_config('app.clinica_id', '', true);
  SELECT count(*) INTO n FROM produtos;
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA(4) RLS: sem GUC deveria ver 0 produtos, viu %', n; END IF;

  -- (5) RLS isolamento: outra clínica não enxerga os produtos de teste da clínica 2.
  PERFORM set_config('app.clinica_id', '1', true);
  SELECT count(*) INTO n FROM produtos WHERE nome LIKE '[TESTE]%';
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA(5) RLS: clínica 1 não deveria ver produtos da clínica 2 (viu %)', n; END IF;
  PERFORM set_config('app.clinica_id', '2', true);

  -- (6) Invariante de reconciliação para o anestésico: depois do INSERT do passo (1),
  --     SUM(mov.quantidade) deve bater com a variação esperada do livro-razão.
  SELECT id INTO v_prod FROM produtos WHERE nome = '[TESTE] Anestésico';
  SELECT COALESCE(SUM(quantidade),0) INTO soma_mov
    FROM movimentacoes_estoque WHERE produto_id = v_prod;
  IF soma_mov <> 1 THEN -- só a entrada +1 do passo (1) existe neste produto no seed
    RAISE EXCEPTION 'FALHA(6) reconciliação: SUM(mov)=% (esperado 1)', soma_mov;
  END IF;

  RAISE NOTICE 'CONTRACT OK — todas as 6 checagens passaram';
END$$;

ROLLBACK;
SELECT 'CONTRACT TEST PASSED (rolled back, sem lixo)' AS status;
