-- ============================================================================
-- 007-fonte-da-verdade-somente-leitura.sql
--
-- Reafirma, DEPOIS dos grants amplos, que as tabelas de regra não são graváveis
-- pela aplicação.
--
-- POR QUE ESTE ARQUIVO EXISTE E NÃO BASTA O REVOKE NO 007/008 DA CAMADA-A-V2:
--
--   verify.mjs descobre as migrações de cada módulo automaticamente, mas empurra
--   os arquivos de `seguranca/` para o FIM da fila. Logo camada-a-v2/007 e /008
--   rodam ANTES de seguranca/004-auth-e-grants.sql, cuja linha 14 é:
--
--       GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_painel;
--
--   ou seja: o REVOKE feito lá é desfeito aqui, e a escalada volta no deploy real
--   sem aparecer em teste nenhum — porque num banco montado à mão o REVOKE é a
--   última coisa que roda. Foi assim que passou despercebido.
--
-- O RISCO CONCRETO: `funcao_alcance` é consultada por fn_por_clinica, que é
-- SECURITY DEFINER e executa `SELECT %I()` com direitos do dono (BYPASSRLS).
-- Quem escreve nessa tabela escolhe o que o wrapper roda como dono. E
-- `transicao_agendamento` é a máquina de estados: com INSERT, app_painel declara
-- válida qualquer transição, inclusive sair de um estado terminal.
--
-- Uma allowlist só vale se o vigiado não puder editá-la.
--
-- ORDEM OBRIGATÓRIA: este arquivo roda por último, depois de 004 e de
-- 001-lockdown. Ver a lista `passos` em verify.mjs e `BASE` em test-db.mjs.
-- Idempotente.
-- ============================================================================
BEGIN;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['estado_agendamento','transicao_agendamento','funcao_alcance']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relkind = 'r') THEN
      EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I FROM app_painel, app_n8n', t);
      -- SELECT continua: fn_transicao_valida é SECURITY INVOKER e o trigger de
      -- estado roda como o chamador. Sem SELECT, todo UPDATE de status do painel
      -- falha com 42501.
      EXECUTE format('GRANT SELECT ON %I TO app_painel', t);
    END IF;
  END LOOP;
END $$;

-- O DEFAULT PRIVILEGES de 004 continua valendo para TODA tabela futura. Se um
-- módulo novo criar outra tabela de regra, ela nasce gravável — acrescente o
-- nome ao ARRAY acima. O contract-test 009 da camada-a-v2 falha se isto
-- regredir para as três de hoje.
--
-- app_n8n NÃO recebe SELECT de volta de propósito: 001-lockdown revoga tudo dele
-- e devolve só a allowlist de 5 tabelas. Se um dia o worker precisar dar UPDATE
-- em status direto no banco, ele vai precisar de SELECT nas duas tabelas de
-- estado — mas o caminho previsto é /api/sofia/*, não SQL direto.

COMMIT;
