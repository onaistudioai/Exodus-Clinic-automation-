-- Inspeção p/ fundamentar o módulo Financeiro.
SELECT 'TABELAS' AS bloco, table_name AS a, '' AS b
  FROM information_schema.tables
 WHERE table_schema='public' AND table_type='BASE TABLE'
UNION ALL
SELECT 'clinicas.col', column_name, data_type
  FROM information_schema.columns WHERE table_name='clinicas'
UNION ALL
SELECT 'prontuario_entradas.col', column_name, data_type
  FROM information_schema.columns WHERE table_name='prontuario_entradas'
ORDER BY bloco, a;
