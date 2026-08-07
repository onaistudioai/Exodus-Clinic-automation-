-- ============================================================================
-- 007-escalonamentos.sql — Fila de encaminhamento a humano.
--
-- POR QUÊ: o Anexo I §5 do contrato declara ao cliente 7 situações em que a
-- automação PARA e aciona a equipe. Sem esta tabela o encaminhamento não tem
-- onde aterrissar: o nó do n8n desviaria a conversa e ninguém ficaria sabendo.
-- Cláusula declarada e não cumprida é passivo, não proteção.
--
-- REGRA: o sistema NÃO avalia gravidade. Ele reconhece o gatilho, registra e sai
-- do caminho. Falso positivo é o erro que se prefere cometer.
--
-- Padrão herdado de 001-reativacao.sql: RLS FORCE + rls_tenant (fail-closed),
-- app_painel/app_n8n NOBYPASSRLS. Aplicar via _run-sql.mjs. Idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- MUTÁVEL de propósito (a equipe resolve e fecha). O que é imutável aqui é o
-- histórico da conversa, que já vive no log de mensagens — não se duplica prova.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS escalonamentos (
  id            BIGSERIAL PRIMARY KEY,
  clinica_id    INTEGER NOT NULL REFERENCES clinicas(id),
  contato_id    INTEGER REFERENCES contatos_whatsapp(id),
  chat_id       TEXT NOT NULL,              -- redundante ao contato: o gatilho pode
                                            -- vir de número ainda não cadastrado
  gatilho       TEXT NOT NULL CHECK (gatilho IN (
                  'sintoma_clinico',        -- §5.1 dor, sangramento, febre, reação
                  'duvida_clinica',         -- §5.2 indicação, medicação, "é normal?"
                  'midia_para_avaliacao',   -- §5.3 foto/exame enviado
                  'reclamacao',             -- §5.4 insatisfação, ameaça jurídica
                  'pediu_humano',           -- §5.5 pedido explícito
                  'nao_compreendido',       -- §5.6 duas falhas seguidas
                  'fora_de_escopo'          -- §5.7
                )),
  trecho        TEXT,                       -- mensagem que disparou (evidência)
  status        TEXT NOT NULL DEFAULT 'aberto'
                  CHECK (status IN ('aberto','em_atendimento','resolvido')),
  atendido_por  INTEGER REFERENCES usuarios(id),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atendido_em   TIMESTAMPTZ,
  resolvido_em  TIMESTAMPTZ
);

-- a fila do painel: abertos primeiro, mais antigo no topo (quem espera há mais tempo)
CREATE INDEX IF NOT EXISTS idx_escalonamentos_fila
  ON escalonamentos (clinica_id, criado_em) WHERE status <> 'resolvido';

-- anti-flood: um mesmo chat não gera fila nova enquanto tiver item aberto.
-- Sem isso, paciente que manda 5 mensagens seguidas com dor cria 5 chamados.
CREATE UNIQUE INDEX IF NOT EXISTS uq_escalonamento_aberto_por_chat
  ON escalonamentos (clinica_id, chat_id) WHERE status = 'aberto';

-- ===========================================================================
-- RLS — fail-closed + FORCE.
-- ===========================================================================
ALTER TABLE escalonamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalonamentos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_tenant ON escalonamentos;
CREATE POLICY rls_tenant ON escalonamentos
  USING (clinica_id = NULLIF(current_setting('app.clinica_id', true), '')::int)
  WITH CHECK (clinica_id = NULLIF(current_setting('app.clinica_id', true), '')::int);

-- ===========================================================================
-- abrir_escalonamento — chamado pelo n8n. Ponto único de entrada.
-- Idempotente por chat: se já há item aberto, devolve o existente em vez de
-- criar outro. Resolve o contato quando ele existe; não falha quando não existe
-- (número novo também pode pedir socorro).
-- Retorna o id do escalonamento aberto.
-- ===========================================================================
CREATE OR REPLACE FUNCTION abrir_escalonamento(
  p_chat_id TEXT,
  p_gatilho TEXT,
  p_trecho  TEXT DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
  v_id      BIGINT;
  v_contato INTEGER;
BEGIN
  SELECT id INTO v_id FROM escalonamentos
   WHERE clinica_id = current_setting('app.clinica_id')::int
     AND chat_id = p_chat_id AND status = 'aberto';
  IF v_id IS NOT NULL THEN
    RETURN v_id;   -- já está na fila; não duplica
  END IF;

  SELECT id INTO v_contato FROM contatos_whatsapp
   WHERE chat_id = p_chat_id
     AND clinica_id = current_setting('app.clinica_id')::int;

  INSERT INTO escalonamentos (clinica_id, contato_id, chat_id, gatilho, trecho)
  VALUES (current_setting('app.clinica_id')::int, v_contato, p_chat_id, p_gatilho, p_trecho)
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$ LANGUAGE plpgsql;

-- ===========================================================================
-- GRANTS. n8n abre; painel lê e fecha. Ninguém apaga — histórico de
-- encaminhamento é o que prova o cumprimento do Anexo I §5.
-- ===========================================================================
GRANT SELECT, INSERT, UPDATE ON escalonamentos TO app_painel;
GRANT SELECT, INSERT          ON escalonamentos TO app_n8n;
GRANT USAGE, SELECT ON SEQUENCE escalonamentos_id_seq TO app_painel, app_n8n;
GRANT EXECUTE ON FUNCTION abrir_escalonamento(TEXT,TEXT,TEXT) TO app_painel, app_n8n;

COMMIT;

-- ===========================================================================
-- VERIFICAÇÃO:
--   SET app.clinica_id = '2';
--   SELECT abrir_escalonamento('5548999@c.us','sintoma_clinico','estou com dor');
--   SELECT abrir_escalonamento('5548999@c.us','sintoma_clinico','ainda dói');  -- mesmo id
--   SELECT id, gatilho, status FROM escalonamentos ORDER BY criado_em DESC LIMIT 5;
-- ===========================================================================
