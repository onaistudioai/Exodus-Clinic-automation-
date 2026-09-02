-- ============================================================================
-- 003-contract-test.sql — prova executável das garantias da política.
--
-- Diferente dos contract-tests dos outros módulos, este NÃO testa isolamento
-- cross-tenant: papel/acao/papel_acao não têm clinica_id de propósito (são
-- regra do produto, não dado de clínica). O que precisa de prova aqui é outra
-- coisa, e é mais perigosa: que a aplicação não consegue REESCREVER a própria
-- política enquanto roda.
--
-- Roda como qualquer role — as asserções usam has_table_privilege('app_painel',
-- ...), que não exige SER app_painel. BEGIN ... ROLLBACK.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_lista text;
  v_n     int;
BEGIN
  -- ==========================================================================
  -- (1) SOMENTE-LEITURA EM RUNTIME.
  -- O seguranca/004 faz GRANT SELECT,INSERT,UPDATE ON ALL TABLES para
  -- app_painel. Se o seguranca/007 não cobrir estas tabelas, a aplicação passa
  -- a poder editar quem pode o quê em runtime — escalada de privilégio pela
  -- porta da frente. Este bloco é o detector desse buraco.
  -- ==========================================================================
  SELECT string_agg(t.tabela || ':' || p.priv, ', '), count(*) INTO v_lista, v_n
    FROM (VALUES ('papel'),('acao'),('papel_acao'),
                 ('estado_solicitacao'),('transicao_solicitacao')) AS t(tabela)
   CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE')) AS p(priv)
   WHERE to_regclass(t.tabela) IS NOT NULL
     AND has_table_privilege('app_painel', t.tabela, p.priv);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'FALHA(1): tabela de regra GRAVAVEL por app_painel: % — seguranca/007 nao as cobriu', v_lista;
  END IF;

  -- ==========================================================================
  -- (2) A LEITURA PRECISA FUNCIONAR. Trancar demais quebra o login: sem SELECT,
  -- requireAcao() não decide e nega tudo, para todo mundo.
  -- ==========================================================================
  SELECT string_agg(t.tabela, ', '), count(*) INTO v_lista, v_n
    FROM (VALUES ('papel'),('acao'),('papel_acao')) AS t(tabela)
   WHERE NOT has_table_privilege('app_painel', t.tabela, 'SELECT');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'FALHA(2): politica ILEGIVEL por app_painel: % — o painel negaria tudo', v_lista;
  END IF;

  -- ==========================================================================
  -- (3) FAIL-CLOSED estrutural: papel_acao não pode apontar para ação que não
  -- existe. A FK já garante; isto prova que a FK está lá.
  -- ==========================================================================
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'papel_acao'::regclass AND contype = 'f'
       AND confrelid = 'acao'::regclass
  ) THEN
    RAISE EXCEPTION 'FALHA(3): papel_acao sem FK para acao — ação órfã passaria a existir';
  END IF;

  -- ==========================================================================
  -- (4) COERÊNCIA DE `sensivel`. Ação sensível que NENHUM papel executa é uma
  -- armadilha: toda tentativa vira pedido de aprovação que ninguém pode
  -- aprovar — uma fila que só cresce.
  -- ==========================================================================
  SELECT string_agg(a.chave, ', '), count(*) INTO v_lista, v_n
    FROM acao a
   WHERE a.sensivel
     AND NOT EXISTS (SELECT 1 FROM papel_acao pa WHERE pa.acao_chave = a.chave);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'FALHA(4): acao sensivel sem nenhum aprovador possivel: %', v_lista;
  END IF;

  -- ==========================================================================
  -- (5) A REGRA QUE SUSTENTA A FILA: quem aprova precisa existir. Se
  -- 'aprovar_solicitacao' não pertence a ninguém, todo pedido fica preso.
  -- ==========================================================================
  IF to_regclass('solicitacao_aprovacao') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM papel_acao WHERE acao_chave = 'aprovar_solicitacao') THEN
    RAISE EXCEPTION 'FALHA(5): ninguem pode aprovar_solicitacao — a fila nasceria travada';
  END IF;

  RAISE NOTICE 'OK  acesso/003-contract-test: politica somente-leitura, legivel e fail-closed';
END $$;

ROLLBACK;
