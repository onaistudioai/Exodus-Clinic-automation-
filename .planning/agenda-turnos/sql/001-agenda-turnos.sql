-- ============================================================================
-- 001-agenda-turnos.sql — Módulos Agenda + Turnos (AIOS.clinic / aios-painel)
-- Fase 2 / Wave 1 / P1 (OPUS). Decisões D1–D6 + K1–K3 (PROJECT_SPEC).
-- K1 VERIFICADO ao vivo 2026-06-22: writer SOFIA = role app_n8n (BYPASSRLS=true),
--   logo RLS FORCE em agendamentos NÃO quebra o agendamento por WhatsApp.
-- Padrão herdado de Estoque/Reativação/Financeiro (RLS FORCE + GUC, grants app_painel).
-- Aplicar via runner sofia-demo/sql/_run-sql.mjs (roda como postgres superuser).
-- Idempotente. Backfill cobre os agendamentos existentes (hoje 2, clínica 2).
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- timezone por clínica (K2): IANA, default São Paulo.
ALTER TABLE clinicas ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

-- ---------------------------------------------------------------------------
-- profissionais — entidade real (D2). usuario_id nullable (profissional ≠ login).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profissionais (
  id                  SERIAL PRIMARY KEY,
  clinica_id          INTEGER NOT NULL REFERENCES clinicas(id),
  nome                TEXT NOT NULL,
  especialidade       TEXT,
  usuario_id          INTEGER REFERENCES usuarios(id),
  profissional_legado TEXT,
  ativo               BOOLEAN NOT NULL DEFAULT true,
  criado_em           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prof_ativos ON profissionais (clinica_id) WHERE ativo;
CREATE UNIQUE INDEX IF NOT EXISTS uq_prof_nome ON profissionais (clinica_id, lower(nome));

-- ---------------------------------------------------------------------------
-- servicos — catálogo nome → duração padrão (D1).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS servicos (
  id          SERIAL PRIMARY KEY,
  clinica_id  INTEGER NOT NULL REFERENCES clinicas(id),
  nome        TEXT NOT NULL,
  duracao_min INTEGER NOT NULL DEFAULT 30,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  criado_em   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_duracao_pos CHECK (duracao_min > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_servico_nome ON servicos (clinica_id, lower(nome));

-- ---------------------------------------------------------------------------
-- turnos — janela recorrente semanal (D6) = fonte de disponibilidade.
-- dia_semana 0=domingo..6=sábado (extract(dow)). almoço = dois turnos.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS turnos (
  id              SERIAL PRIMARY KEY,
  clinica_id      INTEGER NOT NULL REFERENCES clinicas(id),
  profissional_id INTEGER NOT NULL REFERENCES profissionais(id),
  dia_semana      SMALLINT NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio     TIME NOT NULL,
  hora_fim        TIME NOT NULL,
  vigencia_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
  vigencia_fim    DATE,
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_turno_horas CHECK (hora_fim > hora_inicio)
);
CREATE INDEX IF NOT EXISTS idx_turnos_prof
  ON turnos (clinica_id, profissional_id, dia_semana) WHERE ativo;

-- ---------------------------------------------------------------------------
-- bloqueios — exceção pontual (férias/folga/feriado/ausência). prof NULL = clínica toda.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bloqueios (
  id              SERIAL PRIMARY KEY,
  clinica_id      INTEGER NOT NULL REFERENCES clinicas(id),
  profissional_id INTEGER REFERENCES profissionais(id),
  inicio          TIMESTAMPTZ NOT NULL,
  fim             TIMESTAMPTZ NOT NULL,
  motivo          TEXT,
  criado_em       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_bloqueio_intervalo CHECK (fim > inicio)
);
CREATE INDEX IF NOT EXISTS idx_bloqueios_prof
  ON bloqueios (clinica_id, profissional_id, inicio);

-- ---------------------------------------------------------------------------
-- agendamentos_sofia_demo — EVOLUÇÃO (fonte única, D4). Colunas NOVAS nullable.
-- ---------------------------------------------------------------------------
ALTER TABLE agendamentos_sofia_demo
  ADD COLUMN IF NOT EXISTS profissional_id         INTEGER REFERENCES profissionais(id),
  ADD COLUMN IF NOT EXISTS servico_id              INTEGER REFERENCES servicos(id),
  ADD COLUMN IF NOT EXISTS inicio                  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fim                     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS overbooking_intencional BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS profissional_legado     TEXT;

-- chat_id era NOT NULL (todo agendamento vinha da SOFIA/WhatsApp). Agendamento de
-- BALCÃO (painel) pode não ter WhatsApp → nullable. A SOFIA continua setando.
ALTER TABLE agendamentos_sofia_demo ALTER COLUMN chat_id DROP NOT NULL;

-- ===========================================================================
-- BACKFILL — cria profissionais/servicos a partir dos textos distintos e liga
-- os agendamentos existentes. inicio/fim a partir de data+hora no timezone da clínica.
-- ===========================================================================
-- profissionais a partir dos valores textuais distintos
INSERT INTO profissionais (clinica_id, nome, profissional_legado)
SELECT DISTINCT a.clinica_id, a.profissional, a.profissional
  FROM agendamentos_sofia_demo a
 WHERE a.profissional IS NOT NULL AND btrim(a.profissional) <> ''
ON CONFLICT (clinica_id, lower(nome)) DO NOTHING;

-- servicos a partir dos valores textuais distintos (duração default 30)
INSERT INTO servicos (clinica_id, nome)
SELECT DISTINCT a.clinica_id, a.servico
  FROM agendamentos_sofia_demo a
 WHERE a.servico IS NOT NULL AND btrim(a.servico) <> ''
ON CONFLICT (clinica_id, lower(nome)) DO NOTHING;

-- liga profissional_id/servico_id + calcula inicio/fim no fuso da clínica
-- subqueries correlacionadas (UPDATE...FROM não permite o alvo `a` no ON de um JOIN).
UPDATE agendamentos_sofia_demo a
   SET profissional_id = (SELECT p.id FROM profissionais p
                           WHERE p.clinica_id = a.clinica_id AND lower(p.nome) = lower(a.profissional)),
       servico_id = (SELECT s.id FROM servicos s
                       WHERE s.clinica_id = a.clinica_id AND lower(s.nome) = lower(a.servico)),
       profissional_legado = COALESCE(a.profissional_legado, a.profissional),
       -- data_agendamento é `date` e hora é `time`, ambos em hora LOCAL da clínica:
       -- (date + time) = timestamp local; AT TIME ZONE tz o ancora no fuso → timestamptz.
       inicio = (a.data_agendamento + a.hora_agendamento) AT TIME ZONE c.timezone,
       fim = ((a.data_agendamento + a.hora_agendamento) AT TIME ZONE c.timezone)
             + (COALESCE((SELECT s.duracao_min FROM servicos s
                           WHERE s.clinica_id = a.clinica_id AND lower(s.nome) = lower(a.servico)), 30)
                || ' min')::interval
  FROM clinicas c
 WHERE c.id = a.clinica_id
   AND a.hora_agendamento IS NOT NULL
   AND (a.inicio IS NULL OR a.profissional_id IS NULL);

-- ===========================================================================
-- ANTI-OVERBOOKING (K3) — após o backfill. Range half-open [inicio,fim).
-- Só vale p/ linhas com profissional+inicio+fim, status ativo e sem encaixe.
-- ===========================================================================
ALTER TABLE agendamentos_sofia_demo DROP CONSTRAINT IF EXISTS no_overbooking;
ALTER TABLE agendamentos_sofia_demo
  ADD CONSTRAINT no_overbooking
  EXCLUDE USING gist (
    profissional_id WITH =,
    (tstzrange(inicio, fim, '[)')) WITH &&
  )
  WHERE (
    profissional_id IS NOT NULL AND inicio IS NOT NULL AND fim IS NOT NULL
    AND status NOT IN ('cancelada','no_show')
    AND NOT overbooking_intencional
  );

-- ===========================================================================
-- RLS — novas tabelas FORCE; agendamentos também (K1: app_n8n bypassa, app_painel não).
-- ===========================================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profissionais','servicos','turnos','bloqueios','agendamentos_sofia_demo'
  ] LOOP
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

-- GRANTS — app_painel (NOBYPASSRLS).
GRANT SELECT, INSERT, UPDATE, DELETE ON profissionais TO app_painel;
GRANT SELECT, INSERT, UPDATE, DELETE ON servicos      TO app_painel;
GRANT SELECT, INSERT, UPDATE, DELETE ON turnos        TO app_painel;
GRANT SELECT, INSERT, UPDATE, DELETE ON bloqueios     TO app_painel;
GRANT SELECT, INSERT, UPDATE         ON agendamentos_sofia_demo TO app_painel;
GRANT USAGE, SELECT ON SEQUENCE
  profissionais_id_seq, servicos_id_seq, turnos_id_seq, bloqueios_id_seq TO app_painel;

COMMIT;

-- ===========================================================================
-- VERIFICAÇÃO (rodar separado, com SET app.clinica_id):
--   SET app.clinica_id='2';
--   SELECT count(*) FROM profissionais;                 -- da Bella
--   SELECT id, profissional_id, servico_id, inicio, fim FROM agendamentos_sofia_demo;
--   RESET app.clinica_id; SELECT count(*) FROM turnos;  -- 0 (fail-closed sob app_painel)
-- ===========================================================================
