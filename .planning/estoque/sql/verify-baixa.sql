-- verify-baixa.sql — confere a baixa do ÚLTIMO atendimento com saída de estoque (Aurora).
-- Esperado p/ um atendimento tipo 'procedimento' com o seed:
--   luva 'consumo' -3 (custo 10) + -2 (custo 12), anestésico 'consumo' -2 (custo 5.5),
--   gaze 'divergencia' -1 (custo 0). custo_total = 65.00.
WITH ult AS (
  SELECT max(entrada_prontuario_id) AS eid
    FROM movimentacoes_estoque WHERE clinica_id = 2 AND tipo = 'saida'
)
SELECT p.nome AS produto, m.motivo, m.quantidade, m.custo_unitario,
       (-m.quantidade * COALESCE(m.custo_unitario, 0)) AS custo_linha,
       m.entrada_prontuario_id AS entrada, m.agendamento_id AS agend,
       round(sum(-m.quantidade * COALESCE(m.custo_unitario, 0)) OVER (), 2) AS custo_total
  FROM movimentacoes_estoque m
  JOIN produtos p ON p.id = m.produto_id
 WHERE m.clinica_id = 2
   AND m.entrada_prontuario_id = (SELECT eid FROM ult)
 ORDER BY p.nome, m.id;
