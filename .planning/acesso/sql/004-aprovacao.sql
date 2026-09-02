-- ============================================================================
-- 004-aprovacao.sql — pedido de aprovação: a negação que vira fila.
--
-- Quando um papel tenta uma ação `sensivel` que não tem, negar e encerrar joga
-- o problema de volta no balcão ("chama o dono"). O registro aqui preserva a
-- intenção: o QUE ia ser feito, POR QUEM, e com QUAIS argumentos — para que o
-- aprovador execute exatamente aquilo, sem redigitar e sem interpretar.
--
-- DECISÃO TRAVADA (2026-09-01, com a sessão dona de estado_agendamento):
-- estado_solicitacao/transicao_solicitacao replicam a FORMA de
-- estado_agendamento/transicao_agendamento — estados com coluna `terminal`,
-- transições como dado, regras DERIVADAS de `NOT terminal` em vez de escritas à
-- mão — mas são TABELAS SEPARADAS, de propósito, e não devem ser colapsadas.
--
-- A pergunta foi levantada e respondida: dois pares com a mesma forma parece o
-- começo da duplicação que motivou toda a fonte única de estados. Não é. O que
-- estava duplicado lá era a LISTA (os mesmos estados escritos em 4 lugares que
-- podiam divergir); aqui as listas são disjuntas — nenhum estado de
-- agendamento é estado de solicitação. Unificar as tabelas exigiria FK
-- composta com discriminador de entidade, trocando uma garantia que o Postgres
-- aplica sozinho por uma convenção que alguém pode esquecer de respeitar.
--
-- O que impede a divergência aqui não é a tabela ser uma só, é a forma estar
-- documentada como a MESMA decisão tomada duas vezes — que é o papel deste
-- comentário e do equivalente em camada-a-v2/007-estados-fonte-unica.sql.
--
-- Idempotente. Roda DEPOIS de 001-acesso.sql.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- As duas ações que a própria fila introduz.
-- `aprovar_solicitacao` é `sensivel = FALSE` de propósito: se aprovar fosse
-- sensível, uma negação de aprovação geraria uma solicitação para aprovar a
-- aprovação — recursão infinita numa tabela.
-- ---------------------------------------------------------------------------
INSERT INTO acao (chave, modulo, escrita, sensivel, descricao) VALUES
  ('ver_solicitacoes',    'acesso', FALSE, FALSE, 'Ver os pedidos de aprovação da clínica'),
  ('aprovar_solicitacao', 'acesso', TRUE,  FALSE, 'Aprovar ou negar um pedido de aprovação')
ON CONFLICT (chave) DO UPDATE SET
  modulo = EXCLUDED.modulo, escrita = EXCLUDED.escrita,
  sensivel = EXCLUDED.sensivel, descricao = EXCLUDED.descricao;

INSERT INTO papel_acao (papel_chave, acao_chave) VALUES
  -- Todos VEEM a própria fila; só o admin decide. Se a recepção não enxergasse
  -- o pedido que ela mesma criou, o chat não teria como dizer "está pendente".
  ('recepcao','ver_solicitacoes'), ('medico','ver_solicitacoes'), ('admin','ver_solicitacoes'),
  ('admin','aprovar_solicitacao')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- estado_solicitacao — a lista de estados como DADO. `terminal` é o que faz as
-- regras serem derivadas: "só pendente aceita decisão" é `NOT terminal`, não
-- uma lista repetida em cada consulta.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS estado_solicitacao (
  chave     TEXT PRIMARY KEY,
  rotulo    TEXT NOT NULL,
  terminal  BOOLEAN NOT NULL
);

INSERT INTO estado_solicitacao (chave, rotulo, terminal) VALUES
  ('pendente', 'Aguardando aprovação', FALSE),
  ('aprovada', 'Aprovada',             TRUE),
  ('negada',   'Negada',               TRUE),
  ('expirada', 'Expirada',             TRUE)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, terminal = EXCLUDED.terminal;

CREATE TABLE IF NOT EXISTS transicao_solicitacao (
  de    TEXT NOT NULL REFERENCES estado_solicitacao (chave),
  para  TEXT NOT NULL REFERENCES estado_solicitacao (chave),
  PRIMARY KEY (de, para)
);

INSERT INTO transicao_solicitacao (de, para) VALUES
  ('pendente','aprovada'),
  ('pendente','negada'),
  ('pendente','expirada')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- solicitacao_aprovacao — o pedido em si. TEM clinica_id: diferente das tabelas
-- de política, isto é dado de clínica e entra na RLS de tenant normalmente
-- (o 001-lockdown.sql varre por clinica_id e vai pegá-la sozinho).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS solicitacao_aprovacao (
  id             BIGSERIAL PRIMARY KEY,
  clinica_id     INTEGER NOT NULL REFERENCES clinicas(id),
  acao_chave     TEXT NOT NULL REFERENCES acao (chave),
  solicitante_id INTEGER NOT NULL REFERENCES usuarios(id),
  -- Os argumentos exatos da ação original. O aprovador executa ISTO, não uma
  -- reconstrução: reconstruir a partir de texto é como o pedido vira outra coisa.
  argumentos     JSONB NOT NULL,
  justificativa  TEXT,
  estado         TEXT NOT NULL DEFAULT 'pendente'
                   REFERENCES estado_solicitacao (chave),
  decidido_por   INTEGER REFERENCES usuarios(id),
  decidido_em    TIMESTAMPTZ,
  expira_em      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '48 hours',
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Quem decide não pode ser quem pede, nem quando o papel permitiria ambos.
  -- Auto-aprovação transformaria a fila num carimbo.
  CONSTRAINT chk_nao_autoaprova CHECK (decidido_por IS DISTINCT FROM solicitante_id),
  -- Estado terminal exige decisor e data; pendente não pode tê-los. Impede a
  -- linha meio-decidida que nenhuma tela sabe renderizar.
  CONSTRAINT chk_decisao_coerente CHECK (
    (estado = 'pendente' AND decidido_por IS NULL AND decidido_em IS NULL)
    OR (estado = 'expirada' AND decidido_por IS NULL)
    OR (estado IN ('aprovada','negada') AND decidido_por IS NOT NULL AND decidido_em IS NOT NULL)
  )
);

-- A fila que a tela do dono lê: pendentes da clínica, mais antigas primeiro.
CREATE INDEX IF NOT EXISTS idx_solicitacao_fila
  ON solicitacao_aprovacao (clinica_id, estado, criado_em);

-- ---------------------------------------------------------------------------
-- A máquina de estados como TRIGGER, lendo transicao_solicitacao. Nenhuma lista
-- de estados escrita aqui dentro — estado novo é INSERT em estado_solicitacao.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_transicao_solicitacao_valida()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NOT EXISTS (
      SELECT 1 FROM transicao_solicitacao t
       WHERE t.de = OLD.estado AND t.para = NEW.estado
    ) THEN
      RAISE EXCEPTION 'Transição inválida de solicitação: % -> %', OLD.estado, NEW.estado
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS t_estado_solicitacao ON solicitacao_aprovacao;
CREATE TRIGGER t_estado_solicitacao
  BEFORE UPDATE ON solicitacao_aprovacao
  FOR EACH ROW EXECUTE FUNCTION fn_transicao_solicitacao_valida();

-- ---------------------------------------------------------------------------
-- Grants. A aplicação escreve AQUI (é dado, não regra) — ao contrário das
-- tabelas de política. Mas as duas tabelas de estado são regra e entram na
-- mesma trava do seguranca/007.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON solicitacao_aprovacao TO app_painel;
GRANT USAGE, SELECT ON SEQUENCE solicitacao_aprovacao_id_seq TO app_painel;
GRANT SELECT ON estado_solicitacao, transicao_solicitacao TO app_painel;

COMMIT;
