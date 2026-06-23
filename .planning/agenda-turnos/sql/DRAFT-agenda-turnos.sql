-- ============================================================================
-- DRAFT-agenda-turnos.sql — ESBOÇO de schema (Agenda + Turnos). NÃO APLICAR ainda.
-- Para revisão na Fase 1 (ARCHITECTUS). Padrão herdado: RLS FORCE + GUC app.clinica_id,
-- grants app_painel, NUMERIC/timestamptz, índices úteis. Decisões D1–D6+K (PROJECT_SPEC §3).
-- ⚠️ RISCO #1 (K1): RLS em agendamentos só DEPOIS de validar o writer da SOFIA/n8n.
-- ============================================================================

-- btree_gist necessário p/ exclusion constraint (profissional = + range &&)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- timezone por clínica (K2): IANA, default São Paulo. Converte na borda.
ALTER TABLE clinicas ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

-- ---------------------------------------------------------------------------
-- profissionais — entidade real (D2). Separada do login (usuario_id nullable).
-- profissional_legado guarda o texto original p/ casar com agendamentos antigos.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profissionais (
  id                 SERIAL PRIMARY KEY,
  clinica_id         INTEGER NOT NULL REFERENCES clinicas(id),
  nome               TEXT NOT NULL,
  especialidade      TEXT,                         -- simples na v1; filtro por competência = v2
  usuario_id         INTEGER REFERENCES usuarios(id),  -- nullable: profissional sem login
  profissional_legado TEXT,                        -- valor texto original (migração/auditoria)
  ativo              BOOLEAN NOT NULL DEFAULT true,
  criado_em          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prof_ativos ON profissionais (clinica_id) WHERE ativo;

-- ---------------------------------------------------------------------------
-- servicos — catálogo nome → duração padrão (D1). Override por agendamento.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS servicos (
  id            SERIAL PRIMARY KEY,
  clinica_id    INTEGER NOT NULL REFERENCES clinicas(id),
  nome          TEXT NOT NULL,
  duracao_min   INTEGER NOT NULL DEFAULT 30,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_duracao_pos CHECK (duracao_min > 0),
  UNIQUE (clinica_id, lower(nome))
);

-- ---------------------------------------------------------------------------
-- turnos — janela recorrente semanal (D6) = fonte de disponibilidade.
-- dia_semana: 0=domingo .. 6=sábado (extract(dow)). vigência p/ trocar escala no tempo.
-- almoço: modele como DOIS turnos (8-12 e 13-18), não como bloqueio recorrente.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS turnos (
  id              SERIAL PRIMARY KEY,
  clinica_id      INTEGER NOT NULL REFERENCES clinicas(id),
  profissional_id INTEGER NOT NULL REFERENCES profissionais(id),
  dia_semana      SMALLINT NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio     TIME NOT NULL,
  hora_fim        TIME NOT NULL,
  vigencia_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
  vigencia_fim    DATE,                              -- NULL = sem fim
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_turno_horas CHECK (hora_fim > hora_inicio)
);
CREATE INDEX IF NOT EXISTS idx_turnos_prof
  ON turnos (clinica_id, profissional_id, dia_semana) WHERE ativo;

-- ---------------------------------------------------------------------------
-- bloqueios — exceção pontual (férias/folga/feriado/ausência) que fura o turno (C2/H2).
-- profissional_id NULL = bloqueio da clínica inteira (feriado). Intervalo timestamptz.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bloqueios (
  id              SERIAL PRIMARY KEY,
  clinica_id      INTEGER NOT NULL REFERENCES clinicas(id),
  profissional_id INTEGER REFERENCES profissionais(id),  -- NULL = clínica toda
  inicio          TIMESTAMPTZ NOT NULL,
  fim             TIMESTAMPTZ NOT NULL,
  motivo          TEXT,
  criado_em       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_bloqueio_intervalo CHECK (fim > inicio)
);
CREATE INDEX IF NOT EXISTS idx_bloqueios_prof
  ON bloqueios (clinica_id, profissional_id, inicio);

-- ---------------------------------------------------------------------------
-- agendamentos_sofia_demo — EVOLUÇÃO (fonte única, D4). Colunas NOVAS nullable p/
-- não quebrar o insert atual da SOFIA. inicio/fim derivam de data+hora+timezone (backfill).
-- ---------------------------------------------------------------------------
ALTER TABLE agendamentos_sofia_demo
  ADD COLUMN IF NOT EXISTS profissional_id         INTEGER REFERENCES profissionais(id),
  ADD COLUMN IF NOT EXISTS servico_id              INTEGER REFERENCES servicos(id),
  ADD COLUMN IF NOT EXISTS inicio                  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fim                     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS overbooking_intencional BOOLEAN NOT NULL DEFAULT false;

-- BACKFILL (rascunho — só 2 registros hoje, clínica 2):
--   inicio = (data_agendamento + hora_agendamento) AT TIME ZONE clinicas.timezone
--   fim    = inicio + COALESCE(servico.duracao_min, 30) min
--   profissional_id = match por profissional_legado/nome (revisão manual)
-- (a migração real faz isto num UPDATE ... FROM clinicas/servicos)

-- ANTI-OVERBOOKING (K3): impede sobreposição do MESMO profissional, exceto
-- cancelada/no_show e encaixe explícito. Range half-open [inicio, fim).
ALTER TABLE agendamentos_sofia_demo
  ADD CONSTRAINT no_overbooking
  EXCLUDE USING gist (
    profissional_id WITH =,
    tstzrange(inicio, fim, '[)') WITH &&
  )
  WHERE (
    profissional_id IS NOT NULL AND inicio IS NOT NULL AND fim IS NOT NULL
    AND status NOT IN ('cancelada','no_show')
    AND NOT overbooking_intencional
  );

-- ===========================================================================
-- RLS — novas tabelas: FORCE + policy rls_tenant (padrão herdado).
-- agendamentos_sofia_demo: NÃO LIGAR FORCE aqui — depende de validar o writer
-- da SOFIA/n8n (RISCO #1 / K1). A trava de overbooking NÃO depende de RLS.
-- ===========================================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['profissionais','servicos','turnos','bloqueios'] LOOP
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
GRANT USAGE, SELECT ON SEQUENCE
  profissionais_id_seq, servicos_id_seq, turnos_id_seq, bloqueios_id_seq TO app_painel;
-- agendamentos: app_painel já tem (ou precisa) SELECT/INSERT/UPDATE — confirmar na Fase 2.

-- ===========================================================================
-- ABERTO p/ Fase 1/2 (decidir no plano):
--  - RLS em agendamentos: policy p/ o role do n8n OU BYPASSRLS (testar escrita SOFIA antes).
--  - Disponibilidade: VIEW/função que gera slots livres (turno − bloqueio − agendamento)?
--    provável função SQL `slots_livres(profissional, dia)` chamada pela DAL.
--  - Encaixe: como a UI seta overbooking_intencional sem furar a constraint sem querer.
-- ===========================================================================
