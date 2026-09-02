-- 007-solicitacao-paciente.sql — fila de aprovação para pedidos do WhatsApp
-- que excedem o vínculo (W2g). Quando o gate barra por nível insuficiente ou
-- menoridade, em vez de só negar e encerrar, vira pedido para o balcão decidir.
--
-- REUSA estado_solicitacao/transicao_solicitacao e a função de trigger
-- fn_transicao_solicitacao_valida (.planning/acesso/sql/004-aprovacao.sql) —
-- mesmos 4 estados, mesma pergunta (pendente -> aprovada/negada/expirada).
-- Decisão da sessão par, confirmada: aqui reusar é certo, diferente das listas
-- disjuntas de estado_agendamento/estado_solicitacao (que são a mesma FORMA,
-- não o mesmo dado). Aqui são literalmente os mesmos 4 estados.
--
-- NÃO reusa solicitacao_aprovacao: o solicitante ali é usuarios(id) (um
-- funcionário); aqui é um contato de WhatsApp — pessoa sem login, tabela
-- diferente. `chk_nao_autoaprova` daquela tabela não se aplica: o aprovador é
-- sempre staff, nunca o contato que pediu.
--
-- DISTINTO de escalonamentos (Fase 2, W2e): escalonamento é INFORMATIVO
-- ("venha conferir este número"), a automação para mas ninguém decide nada
-- pelo sistema. Solicitação é ACIONÁVEL ("aprove ou negue ESTE pedido, com
-- ESTES argumentos") — o aprovador decide e o efeito roda sob a autorização
-- dele. Se virasse uma coisa só, a recepção perderia a distinção entre
-- "olhar" e "decidir".
BEGIN;

CREATE TABLE IF NOT EXISTS solicitacao_paciente (
  id              BIGSERIAL PRIMARY KEY,
  clinica_id      INTEGER NOT NULL REFERENCES clinicas(id),
  contato_id      INTEGER REFERENCES contatos_whatsapp(id),
  chat_id         TEXT NOT NULL,
  -- NULL quando o pedido é "alegando responsável por alguém que ainda não tem
  -- vínculo" — não há paciente_id para apontar até o balcão confirmar quem é.
  paciente_id     INTEGER REFERENCES pacientes(id),
  motivo          TEXT NOT NULL CHECK (motivo IN (
                    'menor_sem_autoatendimento',  -- item 5: paciente é menor, nunca autoatendimento
                    'nivel_insuficiente',          -- item 4.2: pediu mais do que o vínculo autoriza
                    'responsavel_sem_vinculo'      -- item 4.1: alega ser responsável sem vínculo existente
                  )),
  acao_pretendida TEXT NOT NULL,
  -- Os argumentos exatos da ação pretendida — mesmo motivo de
  -- solicitacao_aprovacao.argumentos: o aprovador executa AQUILO, não uma
  -- reconstrução.
  argumentos      JSONB NOT NULL DEFAULT '{}'::jsonb,
  estado          TEXT NOT NULL DEFAULT 'pendente'
                    REFERENCES estado_solicitacao (chave),
  decidido_por    INTEGER REFERENCES usuarios(id),
  decidido_em     TIMESTAMPTZ,
  expira_em       TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '48 hours',
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_decisao_coerente_paciente CHECK (
    (estado = 'pendente' AND decidido_por IS NULL AND decidido_em IS NULL)
    OR (estado = 'expirada' AND decidido_por IS NULL)
    OR (estado IN ('aprovada','negada') AND decidido_por IS NOT NULL AND decidido_em IS NOT NULL)
  )
);

-- Fila do aprovador: pendentes da clínica, mais antigas primeiro.
CREATE INDEX IF NOT EXISTS idx_solicitacao_paciente_fila
  ON solicitacao_paciente (clinica_id, estado, criado_em);

-- Anti-flood, mesmo espírito do uq_escalonamento_aberto_por_chat (Fase 2): um
-- contato que insiste na MESMA ação não abre um pedido novo a cada mensagem.
-- Por (chat_id, motivo), não só chat_id: um contato pode legitimamente ter um
-- pedido de nível pendente para uma ação E, ao mesmo tempo, ser identificado
-- como menor noutro pedido — motivos diferentes, decisões diferentes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_solicitacao_paciente_aberta
  ON solicitacao_paciente (clinica_id, chat_id, motivo) WHERE estado = 'pendente';

-- Mesma máquina de transição de solicitacao_aprovacao — função genérica, só
-- lê OLD/NEW.estado contra transicao_solicitacao, não referencia tabela
-- nenhuma por nome. Reusar a FUNÇÃO (não só a forma) é o que torna
-- estruturalmente impossível esta tabela aceitar uma transição que a outra
-- rejeitaria.
DROP TRIGGER IF EXISTS t_estado_solicitacao_paciente ON solicitacao_paciente;
CREATE TRIGGER t_estado_solicitacao_paciente
  BEFORE UPDATE ON solicitacao_paciente
  FOR EACH ROW EXECUTE FUNCTION fn_transicao_solicitacao_valida();

-- ---------------------------------------------------------------------------
-- abrir_solicitacao_paciente — ponto único de entrada, idempotente por
-- (chat_id, motivo) igual a abrir_escalonamento. SECURITY INVOKER (default):
-- roda com os direitos de quem chama (app_painel, já com GRANT abaixo),
-- respeita RLS normalmente — esta tabela é dado de clínica, não regra.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION abrir_solicitacao_paciente(
  p_chat_id         TEXT,
  p_paciente_id     INTEGER,
  p_motivo          TEXT,
  p_acao_pretendida TEXT,
  p_argumentos      JSONB DEFAULT '{}'::jsonb
) RETURNS BIGINT AS $$
DECLARE
  v_id      BIGINT;
  v_contato INTEGER;
BEGIN
  SELECT id INTO v_id FROM solicitacao_paciente
   WHERE clinica_id = current_setting('app.clinica_id')::int
     AND chat_id = p_chat_id AND motivo = p_motivo AND estado = 'pendente';
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT id INTO v_contato FROM contatos_whatsapp
   WHERE chat_id = p_chat_id
     AND clinica_id = current_setting('app.clinica_id')::int;

  INSERT INTO solicitacao_paciente
    (clinica_id, contato_id, chat_id, paciente_id, motivo, acao_pretendida, argumentos)
  VALUES
    (current_setting('app.clinica_id')::int, v_contato, p_chat_id, p_paciente_id,
     p_motivo, p_acao_pretendida, p_argumentos)
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Grants — mesmo padrão de solicitacao_aprovacao: dado de clínica, a
-- aplicação escreve. estado_solicitacao/transicao_solicitacao já são SELECT
-- para app_painel desde 004-aprovacao.sql; não repete o GRANT.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON solicitacao_paciente TO app_painel;
GRANT USAGE, SELECT ON SEQUENCE solicitacao_paciente_id_seq TO app_painel;
GRANT EXECUTE ON FUNCTION abrir_solicitacao_paciente(TEXT,INTEGER,TEXT,TEXT,JSONB) TO app_painel;

COMMIT;
