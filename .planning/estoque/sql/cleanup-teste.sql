-- cleanup-teste.sql — remove os dados de TESTE do estoque na Aurora (2) e restaura
-- o médico de teste ao estado original (inativo). Roda como superuser (runner).
-- NÃO mexe na entrada de prontuário de teste (append-only, registro clínico inócuo).
BEGIN;
SET LOCAL app.clinica_id = '2';

-- 1) movimentações de TESTE (livro-razão é append-only -> desliga o trigger só p/ isto).
ALTER TABLE movimentacoes_estoque DISABLE TRIGGER t_mov_append_only;
DELETE FROM movimentacoes_estoque
 WHERE produto_id IN (SELECT id FROM produtos WHERE clinica_id = 2 AND nome LIKE '[TESTE]%');
ALTER TABLE movimentacoes_estoque ENABLE TRIGGER t_mov_append_only;

-- 2) BOM, lotes e produtos de TESTE.
DELETE FROM procedimento_materiais
 WHERE produto_id IN (SELECT id FROM produtos WHERE clinica_id = 2 AND nome LIKE '[TESTE]%');
DELETE FROM lotes
 WHERE produto_id IN (SELECT id FROM produtos WHERE clinica_id = 2 AND nome LIKE '[TESTE]%');
DELETE FROM produtos WHERE clinica_id = 2 AND nome LIKE '[TESTE]%';

-- 3) médico de teste volta a INATIVO (estado original; tira a conta de senha conhecida do ar).
UPDATE usuarios SET ativo = false
 WHERE id = 3 AND clinica_id = 2 AND email = 'medico.teste@aurora.local';

COMMIT;

SELECT
  (SELECT count(*) FROM produtos WHERE clinica_id = 2 AND nome LIKE '[TESTE]%') AS produtos_teste_restantes,
  (SELECT ativo FROM usuarios WHERE id = 3) AS medico_ativo;
