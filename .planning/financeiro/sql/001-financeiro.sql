-- ============================================================================
-- 001-financeiro.sql — Módulo Financeiro (AIOS.clinic / aios-painel)
-- Fase 2 / Wave 1 / P1 (OPUS). Multi-tenant: clinica_id NOT NULL + FK clinicas.
-- Padrão herdado fielmente de 001-estoque.sql / 001-reativacao.sql:
--   - RLS FORCE + policy rls_tenant (GUC app.clinica_id, fail-closed)
--   - livro-razão append-only via trigger (financeiro_lancamentos = movimentacoes_estoque)
--   - role de app: app_painel (NÃO-dono, NOBYPASSRLS); sem UPDATE/DELETE no livro-razão
-- Decisões travadas (PROJECT_SPEC D1–D8): preço por tipo_atendimento + override;
--   cobrança automática 1×/entrada (não-bloqueante); pagamento manual idempotente
--   (1 lançamento receita por cobrança); caixa derivado só do livro-razão; D0 default.
-- Dinheiro: NUMERIC(12,2), nunca float. Aplicar via runner sofia-demo/sql/_run-sql.mjs.
-- Idempotente (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ============================================================================

BEGIN;

-- clinicas.cnpj — exigido no recibo (E2 da pesquisa). Não existia no schema; nullable.
ALTER TABLE clinicas ADD COLUMN IF NOT EXISTS cnpj TEXT;

-- ---------------------------------------------------------------------------
-- financeiro_precos — tabela de preço por tipo_atendimento (mesmo enum do BOM).
-- 1 preço por (clínica, tipo). Override por cobrança é feito na própria cobrança.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS financeiro_precos (
  id               SERIAL PRIMARY KEY,
  clinica_id       INTEGER NOT NULL REFERENCES clinicas(id),
  tipo_atendimento TEXT NOT NULL CHECK (tipo_atendimento IN
                     ('consulta','retorno','procedimento','avaliacao','limpeza')),
  valor            NUMERIC(12,2) NOT NULL,
  ativo            BOOLEAN NOT NULL DEFAULT true,
  criado_em        TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_preco_nao_neg CHECK (valor >= 0),
  UNIQUE (clinica_id, tipo_atendimento)
);

-- ---------------------------------------------------------------------------
-- financeiro_cobrancas — recebível do paciente por um atendimento. MUTÁVEL (status).
-- Nasce na finalização do prontuário (hook não-bloqueante) com preço vigente.
-- valor pode ser override do preço de tabela. vencimento default = hoje (D0).
-- Anti-duplicata: 1 cobrança automática por entrada_prontuario_id (índice parcial).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS financeiro_cobrancas (
  id                    SERIAL PRIMARY KEY,
  clinica_id            INTEGER NOT NULL REFERENCES clinicas(id),
  paciente_id           INTEGER NOT NULL REFERENCES pacientes(id),
  entrada_prontuario_id INTEGER REFERENCES prontuario_entradas(id),  -- NULL = cobrança avulsa
  agendamento_id        INTEGER REFERENCES agendamentos_sofia_demo(id),
  tipo_atendimento      TEXT CHECK (tipo_atendimento IN
                          ('consulta','retorno','procedimento','avaliacao','limpeza')),
  valor                 NUMERIC(12,2) NOT NULL,
  vencimento            DATE NOT NULL DEFAULT CURRENT_DATE,
  status                TEXT NOT NULL DEFAULT 'aberta'
                          CHECK (status IN ('aberta','paga','cancelada')),
  forma_pagamento       TEXT CHECK (forma_pagamento IN ('pix','cartao','dinheiro','outro')),
  pago_em               TIMESTAMPTZ,
  motivo_cancelamento   TEXT,
  criado_em             TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em         TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_cobranca_valor_nao_neg CHECK (valor >= 0)
);
-- anti-duplicata da cobrança AUTOMÁTICA: 1 por entrada de prontuário.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cobranca_por_entrada
  ON financeiro_cobrancas (clinica_id, entrada_prontuario_id)
  WHERE entrada_prontuario_id IS NOT NULL;
-- listagens: a-receber, inadimplência, por período.
CREATE INDEX IF NOT EXISTS idx_cobrancas_status
  ON financeiro_cobrancas (clinica_id, status, vencimento);
CREATE INDEX IF NOT EXISTS idx_cobrancas_paciente
  ON financeiro_cobrancas (clinica_id, paciente_id, criado_em DESC);

-- ---------------------------------------------------------------------------
-- financeiro_lancamentos — LIVRO-RAZÃO append-only do caixa.
-- tipo = receita|despesa; valor SEMPRE positivo (a direção vem do tipo).
-- caixa(período) = SUM(valor FILTER receita) − SUM(valor FILTER despesa).
-- Idempotência do pagamento: 1 lançamento receita por cobrança (índice parcial).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS financeiro_lancamentos (
  id              BIGSERIAL PRIMARY KEY,
  clinica_id      INTEGER NOT NULL REFERENCES clinicas(id),
  tipo            TEXT NOT NULL CHECK (tipo IN ('receita','despesa')),
  categoria       TEXT,                          -- aluguel, salarios, material, impostos...
  valor           NUMERIC(12,2) NOT NULL,        -- sempre > 0
  descricao       TEXT,
  cobranca_id     INTEGER REFERENCES financeiro_cobrancas(id),  -- NULL = avulso
  forma_pagamento TEXT CHECK (forma_pagamento IN ('pix','cartao','dinheiro','outro')),
  usuario_id      INTEGER REFERENCES usuarios(id),
  criado_em       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_lancamento_valor_pos CHECK (valor > 0)
);
-- idempotência do pagamento: nunca 2 receitas para a mesma cobrança.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lancamento_por_cobranca
  ON financeiro_lancamentos (clinica_id, cobranca_id)
  WHERE cobranca_id IS NOT NULL;
-- caixa por período / export CSV.
CREATE INDEX IF NOT EXISTS idx_lancamentos_periodo
  ON financeiro_lancamentos (clinica_id, criado_em);

-- append-only: o livro-razão do caixa NUNCA é alterado/apagado. Correção = estorno (nova linha).
CREATE OR REPLACE FUNCTION trg_lancamentos_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'financeiro_lancamentos é append-only: % proibido (use estorno).', TG_OP;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS t_lancamentos_append_only ON financeiro_lancamentos;
CREATE TRIGGER t_lancamentos_append_only
  BEFORE UPDATE OR DELETE ON financeiro_lancamentos
  FOR EACH ROW EXECUTE FUNCTION trg_lancamentos_append_only();

-- ===========================================================================
-- RLS — fail-closed (sem GUC -> NULL -> 0 linhas), FORCE (nem o dono escapa).
-- ===========================================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'financeiro_precos','financeiro_cobrancas','financeiro_lancamentos'
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

-- ===========================================================================
-- GRANTS — app_painel (NOBYPASSRLS). Livro-razão: só SELECT+INSERT (append-only;
-- defesa em profundidade junto do trigger). Sequences: USAGE p/ INSERT.
-- ===========================================================================
GRANT SELECT, INSERT, UPDATE ON financeiro_precos       TO app_painel;
GRANT SELECT, INSERT, UPDATE ON financeiro_cobrancas    TO app_painel;
GRANT SELECT, INSERT          ON financeiro_lancamentos TO app_painel;
GRANT USAGE, SELECT ON SEQUENCE
  financeiro_precos_id_seq, financeiro_cobrancas_id_seq, financeiro_lancamentos_id_seq
  TO app_painel;

COMMIT;

-- ===========================================================================
-- VERIFICAÇÃO (rodar separado, com SET app.clinica_id):
--   SET app.clinica_id = '2';   -- Bella
--   SELECT count(*) FROM financeiro_cobrancas;             -- só da clínica setada
--   RESET app.clinica_id; SELECT count(*) FROM financeiro_cobrancas;  -- 0 (fail-closed)
-- ===========================================================================
