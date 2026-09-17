-- seed-teste.sql — dados de teste do Módulo Estoque (clínica Aurora = 2). L3 do REVIEW.
-- Idempotente: remove o seed anterior (nome LIKE '[TESTE]%') e recria.
-- Roda com app.clinica_id='2' por causa do WITH CHECK da RLS.
-- ⚠️ Produtos de teste NÃO devem ter movimentações ao limpar; se o E2E já rodou,
--    rode o cleanup de movimentações de teste antes (ver QA-RUNBOOK.md).
BEGIN;
SET LOCAL app.clinica_id = '2';

DELETE FROM procedimento_materiais
 WHERE produto_id IN (SELECT id FROM produtos WHERE nome LIKE '[TESTE]%');
DELETE FROM lotes
 WHERE produto_id IN (SELECT id FROM produtos WHERE nome LIKE '[TESTE]%');
DELETE FROM produtos WHERE nome LIKE '[TESTE]%';

INSERT INTO produtos (clinica_id, nome, categoria, unidade, estoque_minimo, controlado) VALUES
  (2, '[TESTE] Luva Nitrílica', 'descartáveis', 'cx',  5, false),
  (2, '[TESTE] Anestésico',     'medicamentos','amp', 10, true),
  (2, '[TESTE] Gaze Estéril',   'descartáveis', 'pct', 5, false);

-- Luva: 2 lotes p/ exercitar FEFO. Perto vence antes e tem POUCO (3),
-- longe vence depois e tem MUITO (50). BOM consome 5 -> cruza os dois lotes.
INSERT INTO lotes (clinica_id, produto_id, codigo_lote, validade, quantidade, custo_unitario)
SELECT 2, id, 'L-PERTO', CURRENT_DATE + 20,  3,  10.0000 FROM produtos WHERE nome = '[TESTE] Luva Nitrílica';
INSERT INTO lotes (clinica_id, produto_id, codigo_lote, validade, quantidade, custo_unitario)
SELECT 2, id, 'L-LONGE', CURRENT_DATE + 200, 50, 12.0000 FROM produtos WHERE nome = '[TESTE] Luva Nitrílica';

-- Anestésico: 1 lote com folga.
INSERT INTO lotes (clinica_id, produto_id, codigo_lote, validade, quantidade, custo_unitario)
SELECT 2, id, 'A-1', CURRENT_DATE + 120, 20, 5.5000 FROM produtos WHERE nome = '[TESTE] Anestésico';

-- Gaze: SEM lote (estoque zero) -> baixa dispara DIVERGÊNCIA (C3), saldo negativo.

-- BOM do tipo 'procedimento': luva 5 (FEFO 3+2), anestésico 2, gaze 1 (divergência).
INSERT INTO procedimento_materiais (clinica_id, tipo_atendimento, produto_id, quantidade)
SELECT 2, 'procedimento', id, 5 FROM produtos WHERE nome = '[TESTE] Luva Nitrílica';
INSERT INTO procedimento_materiais (clinica_id, tipo_atendimento, produto_id, quantidade)
SELECT 2, 'procedimento', id, 2 FROM produtos WHERE nome = '[TESTE] Anestésico';
INSERT INTO procedimento_materiais (clinica_id, tipo_atendimento, produto_id, quantidade)
SELECT 2, 'procedimento', id, 1 FROM produtos WHERE nome = '[TESTE] Gaze Estéril';

COMMIT;

SELECT 'seed ok' AS status,
  (SELECT count(*) FROM produtos WHERE nome LIKE '[TESTE]%') AS produtos,
  (SELECT count(*) FROM lotes  l JOIN produtos p ON p.id = l.produto_id  WHERE p.nome LIKE '[TESTE]%') AS lotes,
  (SELECT count(*) FROM procedimento_materiais pm JOIN produtos p ON p.id = pm.produto_id WHERE p.nome LIKE '[TESTE]%') AS bom_itens;
