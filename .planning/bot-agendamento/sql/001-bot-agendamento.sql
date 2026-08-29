-- ============================================================================
-- 001-bot-agendamento.sql — spec v1.1 do bot de agendamento.
-- Delta sobre o schema existente. NÃO cria contato/paciente/vínculo: eles já
-- existem como contatos_whatsapp / pacientes / paciente_contato / paciente_responsavel.
-- Idempotente. Aplicar depois de verify.mjs.
-- ============================================================================
BEGIN;

-- --------------------------------------------------------------------------
-- IDENTIDADE — paciente_contato ganha papel e nível. Tabela não é criada.
-- --------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE papel_vinculo AS ENUM ('titular','responsavel','autorizado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE nivel_autorizacao AS ENUM ('nenhum','agendar','agendar_e_consultar','total');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE paciente_contato
  ADD COLUMN IF NOT EXISTS papel papel_vinculo,
  ADD COLUMN IF NOT EXISTS nivel nivel_autorizacao NOT NULL DEFAULT 'nenhum';

-- `titular` booleano já existia; papel deriva dele no backfill e passa a ser a fonte.
UPDATE paciente_contato SET papel = CASE WHEN titular THEN 'titular'::papel_vinculo ELSE 'autorizado'::papel_vinculo END
 WHERE papel IS NULL;
ALTER TABLE paciente_contato ALTER COLUMN papel SET NOT NULL;

-- --------------------------------------------------------------------------
-- AGENDA — reserva temporária, origem e remarcação.
-- --------------------------------------------------------------------------
ALTER TABLE agendamentos_sofia_demo
  ADD COLUMN IF NOT EXISTS reserva_expira_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contato_origem_id INTEGER REFERENCES contatos_whatsapp(id),
  ADD COLUMN IF NOT EXISTS substitui_id      INTEGER REFERENCES agendamentos_sofia_demo(id);

-- status ganha 'reservada' e 'expirada' (I6: esta coluna é a exceção nomeada).
ALTER TABLE agendamentos_sofia_demo DROP CONSTRAINT IF EXISTS agendamentos_sofia_demo_status_check;
ALTER TABLE agendamentos_sofia_demo DROP CONSTRAINT IF EXISTS chk_status_agendamento;
ALTER TABLE agendamentos_sofia_demo ADD CONSTRAINT chk_status_agendamento
  CHECK (status IN ('reservada','agendada','confirmada','cancelada','remarcada','realizada','no_show','expirada'));

-- I1 — anti-overbooking, agora com clinica_id e ciente da reserva expirada.
ALTER TABLE agendamentos_sofia_demo DROP CONSTRAINT IF EXISTS no_overbooking;
ALTER TABLE agendamentos_sofia_demo
  ADD CONSTRAINT no_overbooking
  EXCLUDE USING gist (
    clinica_id      WITH =,
    profissional_id WITH =,
    (tstzrange(inicio, fim, '[)')) WITH &&
  )
  WHERE (
    profissional_id IS NOT NULL AND inicio IS NOT NULL AND fim IS NOT NULL
    AND status NOT IN ('cancelada','no_show','expirada')
    AND NOT overbooking_intencional
  );

-- --------------------------------------------------------------------------
-- EVENTOS — I2 e I3.
-- --------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE tipo_evento AS ENUM ('criado','reservado','confirmado','expirado',
    'cancelado_paciente','cancelado_clinica','compareceu','faltou','remarcado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE origem_evento AS ENUM ('bot','recepcao','profissional','sistema');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS eventos_agendamento (
  id             BIGSERIAL PRIMARY KEY,
  clinica_id     INTEGER NOT NULL REFERENCES clinicas(id),
  agendamento_id INTEGER NOT NULL REFERENCES agendamentos_sofia_demo(id),
  tipo           tipo_evento NOT NULL,
  ocorrido_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  origem         origem_evento NOT NULL,
  ator           TEXT
);
-- I3 ordena por id, não por ocorrido_em: eventos da mesma transação empatam no now().
CREATE INDEX IF NOT EXISTS idx_evt_agend ON eventos_agendamento (agendamento_id, id DESC);

-- --------------------------------------------------------------------------
-- CONVERSA e MEDIÇÃO
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mensagens_bot (
  id            SERIAL PRIMARY KEY,
  clinica_id    INTEGER NOT NULL REFERENCES clinicas(id),
  contato_id    INTEGER NOT NULL REFERENCES contatos_whatsapp(id),
  wa_message_id TEXT,
  direcao       TEXT NOT NULL CHECK (direcao IN ('entrada','saida')),
  conteudo      TEXT,
  ocorrido_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expurgado_em  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_msg_wa
  ON mensagens_bot (wa_message_id) WHERE wa_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS interacoes (
  id           BIGSERIAL PRIMARY KEY,
  clinica_id   INTEGER NOT NULL REFERENCES clinicas(id),
  ocorrido_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  contato_hash TEXT NOT NULL,
  intencao     TEXT NOT NULL,
  modulo       TEXT NOT NULL,
  duracao_ms   INTEGER NOT NULL,
  desfecho     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interacoes_janela ON interacoes (clinica_id, ocorrido_em DESC);

-- --------------------------------------------------------------------------
-- OUTBOX
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notificacoes_saida (
  id            SERIAL PRIMARY KEY,
  clinica_id    INTEGER NOT NULL REFERENCES clinicas(id),
  paciente_id   INTEGER NOT NULL REFERENCES pacientes(id),
  contato_id    INTEGER NOT NULL REFERENCES contatos_whatsapp(id),
  tipo          TEXT NOT NULL,
  agendada_para TIMESTAMPTZ NOT NULL,
  enviada_em    TIMESTAMPTZ,
  tentativas    INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pendente'
);
CREATE INDEX IF NOT EXISTS idx_notif_pendentes
  ON notificacoes_saida (status, agendada_para) WHERE status = 'pendente';

-- --------------------------------------------------------------------------
-- RETENÇÃO — mensagens_bot é a única tabela desta migração com texto livre.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_expurgo_mensagens(p_dias INT DEFAULT 180)
RETURNS INT LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  WITH x AS (
    UPDATE mensagens_bot SET conteudo = NULL, expurgado_em = NOW()
     WHERE expurgado_em IS NULL
       AND ocorrido_em < NOW() - (p_dias || ' days')::interval
    RETURNING 1
  ) SELECT COUNT(*)::INT FROM x;
$fn$;
REVOKE ALL ON FUNCTION fn_expurgo_mensagens(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_expurgo_mensagens(INT) TO app_painel;

-- --------------------------------------------------------------------------
-- I10 — RLS FORCE nas tabelas novas.
-- --------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['eventos_agendamento','mensagens_bot','interacoes','notificacoes_saida'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format($p$
      DROP POLICY IF EXISTS rls_tenant ON %I;
      CREATE POLICY rls_tenant ON %I
        USING (clinica_id = NULLIF(current_setting('app.clinica_id', true), '')::int)
        WITH CHECK (clinica_id = NULLIF(current_setting('app.clinica_id', true), '')::int);
    $p$, t, t);
  END LOOP;
END$$;

-- I2 — append-only imposto pelo banco, não por disciplina.
GRANT SELECT, INSERT ON eventos_agendamento TO app_painel, app_n8n;
REVOKE UPDATE, DELETE ON eventos_agendamento FROM app_painel, app_n8n;
GRANT SELECT, INSERT, UPDATE ON mensagens_bot      TO app_painel, app_n8n;
GRANT SELECT, INSERT         ON interacoes         TO app_painel, app_n8n;
GRANT SELECT, INSERT, UPDATE ON notificacoes_saida TO app_painel, app_n8n;
GRANT USAGE, SELECT ON SEQUENCE
  eventos_agendamento_id_seq, mensagens_bot_id_seq, interacoes_id_seq,
  notificacoes_saida_id_seq TO app_painel, app_n8n;

COMMIT;
