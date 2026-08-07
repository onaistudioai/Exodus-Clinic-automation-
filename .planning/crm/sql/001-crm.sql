-- ============================================================================
-- 001-crm.sql — Módulo CRM da clínica (AIOS.clinic / aios-painel)
-- Camada de relacionamento com o paciente: pipeline por estágio (derivado em
-- runtime no repo, SEM tabela) + ficha 360 (agrega repos existentes) + TAREFAS
-- de follow-up (esta tabela).
--
-- Padrão herdado fielmente de 001-financeiro.sql / 001-reativacao.sql:
--   - RLS FORCE + policy rls_tenant (GUC app.clinica_id, fail-closed)
--   - role de app: app_painel (NÃO-dono, NOBYPASSRLS)
-- Idempotente (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- Aplicar via sofia-demo/sql/_run-sql.mjs (dono = app_n8n).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- crm_tarefas — follow-up de relacionamento por paciente (mutável: status).
-- "Marcar contato" = tarefa nascida já concluida. Não é livro-razão: pode UPDATE.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_tarefas (
  id            BIGSERIAL PRIMARY KEY,
  clinica_id    INTEGER NOT NULL REFERENCES clinicas(id),
  paciente_id   INTEGER NOT NULL REFERENCES pacientes(id),
  titulo        TEXT NOT NULL,
  descricao     TEXT,
  vencimento    DATE,
  status        TEXT NOT NULL DEFAULT 'aberta'
                  CHECK (status IN ('aberta','concluida')),
  criado_por    INTEGER REFERENCES usuarios(id),
  criado_em     TIMESTAMPTZ DEFAULT NOW(),
  concluida_em  TIMESTAMPTZ,
  CONSTRAINT chk_tarefa_titulo_nao_vazio CHECK (length(btrim(titulo)) > 0)
);

-- fila de tarefas abertas de um paciente / da clínica.
CREATE INDEX IF NOT EXISTS idx_crm_tarefas_paciente
  ON crm_tarefas (clinica_id, paciente_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_tarefas_agenda
  ON crm_tarefas (clinica_id, status, vencimento);

-- ===========================================================================
-- RLS — fail-closed (sem GUC -> NULL -> 0 linhas), FORCE (nem o dono escapa).
-- ===========================================================================
ALTER TABLE crm_tarefas ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_tarefas FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_tenant ON crm_tarefas;
CREATE POLICY rls_tenant ON crm_tarefas
  USING (clinica_id = NULLIF(current_setting('app.clinica_id', true), '')::int)
  WITH CHECK (clinica_id = NULLIF(current_setting('app.clinica_id', true), '')::int);

-- ===========================================================================
-- GRANTS — app_painel (NOBYPASSRLS). Tarefa é mutável (concluir) -> UPDATE ok.
-- ===========================================================================
GRANT SELECT, INSERT, UPDATE ON crm_tarefas TO app_painel;
GRANT USAGE, SELECT ON SEQUENCE crm_tarefas_id_seq TO app_painel;

COMMIT;

-- ===========================================================================
-- VERIFICAÇÃO (rodar separado, com SET app.clinica_id):
--   SET app.clinica_id = '2';   -- Bella
--   SELECT count(*) FROM crm_tarefas;                 -- só da clínica setada
--   RESET app.clinica_id; SELECT count(*) FROM crm_tarefas;  -- 0 (fail-closed)
-- ===========================================================================
