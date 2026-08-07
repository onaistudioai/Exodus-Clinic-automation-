-- Inspeção p/ fundamentar o módulo Reativação.
SELECT 'pacientes' AS tabela, column_name, data_type
  FROM information_schema.columns WHERE table_name='pacientes'
UNION ALL
SELECT 'agendamentos_sofia_demo', column_name, data_type
  FROM information_schema.columns WHERE table_name='agendamentos_sofia_demo'
UNION ALL
SELECT 'contatos_whatsapp', column_name, data_type
  FROM information_schema.columns WHERE table_name='contatos_whatsapp'
UNION ALL
SELECT 'paciente_contato', column_name, data_type
  FROM information_schema.columns WHERE table_name='paciente_contato'
ORDER BY tabela, column_name;
