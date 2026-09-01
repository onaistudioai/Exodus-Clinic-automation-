-- ============================================================================
-- 007-fonte-da-verdade-somente-leitura.sql
--
-- Reafirma, DEPOIS dos grants amplos, dois tipos de garantia que
-- seguranca/004-auth-e-grants.sql desfaz sem querer:
--   (a) tabelas de REGRA não são graváveis pela aplicação (somente-leitura);
--   (b) tabelas de LIVRO-RAZÃO continuam append-only (INSERT sim, UPDATE/DELETE
--       não) — nome do arquivo ficou de (a), mas o problema estrutural é o
--       mesmo e (b) foi achado depois, por isso mora aqui também em vez de
--       ganhar um arquivo próprio para uma linha de motivo idêntica.
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
  -- papel/acao/papel_acao acrescentadas em 2026-09-01 (módulo `acesso`,
  -- sessão par `unify-chat-rbac-layer`): a matriz de autorização que vivia em
  -- src/lib/rbac-matriz.ts virou dado no banco, mesmo remédio aplicado a
  -- estado_agendamento/transicao_agendamento. Regra do produto, não dado de
  -- clínica — sem clinica_id, fora da RLS de tenant, mas na MESMA categoria de
  -- "tabela de regra travada contra a aplicação que ela restringe".
  --
  -- estado_solicitacao/transicao_solicitacao (mesmo dia, .planning/acesso/sql/
  -- 004-aprovacao.sql): mesma categoria — regra do fluxo de aprovação, não dado
  -- de clínica. NÃO inclui solicitacao_aprovacao de propósito: aquela tabela TEM
  -- clinica_id, é dado de clínica que a aplicação escreve normalmente, e entra
  -- na RLS de tenant por 001-lockdown, que a varre sozinho.
  FOREACH t IN ARRAY ARRAY['estado_agendamento','transicao_agendamento','funcao_alcance',
                            'papel','acao','papel_acao',
                            'estado_solicitacao','transicao_solicitacao']
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

-- ---------------------------------------------------------------------------
-- (b) LIVROS-RAZÃO APPEND-ONLY POR REVOKE (não por trigger).
--
-- ACHADO (2026-09-01, ao ligar bot-agendamento/002-contract-test.sql no CI
-- pela primeira vez): bot-agendamento/001-bot-agendamento.sql já fazia isso
-- certo desde o início —
--   GRANT SELECT, INSERT ON eventos_agendamento TO app_painel, app_n8n;
--   REVOKE UPDATE, DELETE ON eventos_agendamento FROM app_painel, app_n8n;
-- — mas roda ANTES de seguranca/004, que devolve UPDATE de graça pra
-- app_painel via GRANT ON ALL TABLES. Mesmo defeito estrutural do bloco (a)
-- acima, achado numa tabela que eu não tinha olhado porque o contract-test que
-- prova o invariante estava órfão do CI até hoje.
--
-- Diferente de (a): aqui INSERT precisa continuar liberado — não é a mesma
-- allowlist, por isso é um bloco à parte, não uma entrada a mais no ARRAY.
-- As outras 4 tabelas append-only do schema (movimentacoes_estoque,
-- financeiro_lancamentos, reativacao_envios, consentimento_eventos) impõem a
-- garantia por TRIGGER, não por REVOKE — imunes a este problema por
-- construção. `eventos_agendamento` foi a única encontrada nesse padrão
-- (grep por "REVOKE UPDATE, DELETE ON" em .planning/*/sql/*.sql).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['eventos_agendamento']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relkind = 'r') THEN
      EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM app_painel, app_n8n', t);
    END IF;
  END LOOP;
END $$;

-- O DEFAULT PRIVILEGES de 004 continua valendo para TODA tabela futura. Se um
-- módulo novo criar outra tabela de regra, ela nasce gravável — acrescente o
-- nome ao ARRAY do bloco (a). O contract-test 009 da camada-a-v2 falha se isto
-- regredir para as três originais.
--
-- app_n8n NÃO recebe SELECT de volta de propósito: 001-lockdown revoga tudo dele
-- e devolve só a allowlist de 5 tabelas. Se um dia o worker precisar dar UPDATE
-- em status direto no banco, ele vai precisar de SELECT nas duas tabelas de
-- estado — mas o caminho previsto é /api/sofia/*, não SQL direto.

COMMIT;
