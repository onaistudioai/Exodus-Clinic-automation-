-- reset-medico.sql — TRANSITÓRIO (não commitar): reativa o médico de teste da Aurora
-- e define senha conhecida p/ a camada C. Senha em claro: EstoqueE2E!2026
-- Hash bcrypt custo 12 (mesmo formato do app). Apagar/limpar a senha depois do E2E.
UPDATE usuarios
   SET senha_hash = '$2b$12$O/2FYHIoZ.cvxHhLg0itYu159sloMqSaFsPWKyZlYUMRwYKkZGCj.',
       ativo = true
 WHERE id = 3 AND clinica_id = 2 AND email = 'medico.teste@aurora.local';

SELECT id, email, ativo, (senha_hash IS NOT NULL) AS tem_senha
  FROM usuarios WHERE id = 3 AND clinica_id = 2;
