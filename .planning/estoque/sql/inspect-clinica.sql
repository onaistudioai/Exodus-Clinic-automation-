-- inspect-clinica.sql — valores reais p/ guiar a camada C (clínica Aurora = 2).
SELECT
  (SELECT json_agg(json_build_object('id', id, 'nome', nome, 'email', email,
                                     'ativo', ativo, 'tem_senha', senha_hash IS NOT NULL))
     FROM usuarios WHERE clinica_id = 2 AND papel = 'medico') AS medico,
  (SELECT json_agg(json_build_object('id', id, 'nome', nome_completo, 'status', status))
     FROM pacientes WHERE clinica_id = 2) AS paciente,
  (SELECT json_agg(json_build_object('id', id, 'paciente_id', paciente_id, 'servico', servico,
                                     'status', status, 'data', data_agendamento))
     FROM agendamentos_sofia_demo WHERE clinica_id = 2) AS agendamentos;
