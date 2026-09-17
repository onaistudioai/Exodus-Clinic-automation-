-- ============================================================================
-- 001-estoque.sql — Módulo Estoque (AIOS.clinic / aios-painel)
-- Fase 2 / Wave 1 (OPUS). Multi-tenant: tudo com clinica_id NOT NULL + FK clinicas.
-- Padrão herdado de DRAFT-prontuario-modelo.sql:
--   - RLS FORCE + policy rls_tenant (GUC app.clinica_id, fail-closed)
--   - livro-razão append-only via trigger (igual prontuario_entradas)
--   - role de app: app_painel (NÃO-dono, NOBYPASSRLS)
-- Aplicar via runner sofia-demo/sql/_run-sql.mjs (TCP proxy OFF — constraint C6).
-- Idempotente (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- produtos — catálogo de materiais/insumos por clínica
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS produtos (
  id              SERIAL PRIMARY KEY,
  clinica_id      INTEGER NOT NULL REFERENCES clinicas(id),
  nome            TEXT NOT NULL,
  categoria       TEXT,
  unidade         TEXT NOT NULL DEFAULT 'un',           -- un, cx, ml, g...
  estoque_minimo  NUMERIC(12,2) NOT NULL DEFAULT 0,     -- limiar de ruptura
  controlado      BOOLEAN NOT NULL DEFAULT false,       -- medicamento controlado (ANVISA)
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_estoque_minimo_nao_neg CHECK (estoque_minimo >= 0)
);
CREATE INDEX IF NOT EXISTS idx_produtos_ativos
  ON produtos (clinica_id) WHERE ativo = true;
-- não-UNIQUE: pode haver homônimos legítimos; a UI alerta. Busca por nome:
CREATE INDEX IF NOT EXISTS idx_produtos_nome
  ON produtos (clinica_id, lower(nome));

-- ---------------------------------------------------------------------------
-- lotes — saldo por lote/validade. nivel(produto) = SUM(lotes.quantidade).
-- quantidade É o saldo corrente do lote (pode ir NEGATIVO — política C3).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lotes (
  id              SERIAL PRIMARY KEY,
  clinica_id      INTEGER NOT NULL REFERENCES clinicas(id),
  produto_id      INTEGER NOT NULL REFERENCES produtos(id),
  codigo_lote     TEXT,                                 -- pode ser NULL (sem rastreio de lote)
  validade        DATE,                                 -- NULL = não perecível
  quantidade      NUMERIC(12,2) NOT NULL DEFAULT 0,     -- saldo corrente do lote
  custo_unitario  NUMERIC(12,4) NOT NULL DEFAULT 0,
  criado_em       TIMESTAMPTZ DEFAULT NOW()
);
-- FEFO: consumir lotes que vencem antes primeiro. NULLS LAST = não-perecível por último.
CREATE INDEX IF NOT EXISTS idx_lotes_fefo
  ON lotes (clinica_id, produto_id, validade ASC NULLS LAST);

-- ---------------------------------------------------------------------------
-- movimentacoes_estoque — LIVRO-RAZÃO append-only.
-- quantidade é SINALIZADA: entrada/estorno-de-saída = +, saida/perda = -.
-- Invariante de reconciliação: SUM(mov.quantidade) por produto == SUM(lotes.quantidade).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
  id                    BIGSERIAL PRIMARY KEY,
  clinica_id            INTEGER NOT NULL REFERENCES clinicas(id),
  produto_id            INTEGER NOT NULL REFERENCES produtos(id),
  lote_id               INTEGER REFERENCES lotes(id),       -- NULL só em ajuste sem lote
  tipo                  TEXT NOT NULL CHECK (tipo IN ('entrada','saida','ajuste','estorno')),
  motivo                TEXT NOT NULL CHECK (motivo IN
                          ('compra','consumo','perda','vencimento','ajuste_inventario',
                           'estorno','divergencia')),
  quantidade            NUMERIC(12,2) NOT NULL,             -- sinalizada (+/-)
  custo_unitario        NUMERIC(12,4),                      -- snapshot no momento
  agendamento_id        INTEGER REFERENCES agendamentos_sofia_demo(id),
  entrada_prontuario_id INTEGER REFERENCES prontuario_entradas(id),
  usuario_id            INTEGER REFERENCES usuarios(id),
  observacao            TEXT,
  criado_em             TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_quantidade_nao_zero CHECK (quantidade <> 0)
);
CREATE INDEX IF NOT EXISTS idx_mov_produto
  ON movimentacoes_estoque (clinica_id, produto_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_mov_atendimento
  ON movimentacoes_estoque (clinica_id, entrada_prontuario_id)
  WHERE entrada_prontuario_id IS NOT NULL;

-- append-only: o livro-razão NUNCA é alterado/apagado. Correção = nova linha (estorno/ajuste).
CREATE OR REPLACE FUNCTION trg_mov_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'movimentacoes_estoque é append-only: % proibido (use estorno/ajuste).', TG_OP;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS t_mov_append_only ON movimentacoes_estoque;
CREATE TRIGGER t_mov_append_only
  BEFORE UPDATE OR DELETE ON movimentacoes_estoque
  FOR EACH ROW EXECUTE FUNCTION trg_mov_append_only();

-- ---------------------------------------------------------------------------
-- procedimento_materiais — BOM (kit) chaveado por tipo_atendimento (enum existente).
-- Fase 2 (roadmap): trocar tipo_atendimento por procedimento_id desacoplado.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procedimento_materiais (
  id               SERIAL PRIMARY KEY,
  clinica_id       INTEGER NOT NULL REFERENCES clinicas(id),
  tipo_atendimento TEXT NOT NULL CHECK (tipo_atendimento IN
                     ('consulta','retorno','procedimento','avaliacao','limpeza')),
  produto_id       INTEGER NOT NULL REFERENCES produtos(id),
  quantidade       NUMERIC(12,2) NOT NULL CHECK (quantidade > 0),
  criado_em        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (clinica_id, tipo_atendimento, produto_id)
);
CREATE INDEX IF NOT EXISTS idx_bom_tipo
  ON procedimento_materiais (clinica_id, tipo_atendimento);

-- ===========================================================================
-- RLS (Row-Level Security) — padrão correção #7 do prontuário.
-- Fail-closed: sem GUC -> NULLIF(...,'')::int -> NULL -> 0 linhas.
-- FORCE: nem o dono escapa (app usa role NÃO-dono = app_painel).
-- ===========================================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'produtos','lotes','movimentacoes_estoque','procedimento_materiais'
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
-- GRANTS — app_painel (NOBYPASSRLS). Livro-razão: sem UPDATE/DELETE (trigger
-- já barra, mas o grant é defesa em profundidade). Sequences: USAGE p/ INSERT.
-- ===========================================================================
GRANT SELECT, INSERT, UPDATE ON produtos               TO app_painel;
GRANT SELECT, INSERT, UPDATE ON lotes                  TO app_painel;
GRANT SELECT, INSERT          ON movimentacoes_estoque TO app_painel;
GRANT SELECT, INSERT, UPDATE, DELETE ON procedimento_materiais TO app_painel;
GRANT USAGE, SELECT ON SEQUENCE
  produtos_id_seq, lotes_id_seq, movimentacoes_estoque_id_seq, procedimento_materiais_id_seq
  TO app_painel;

COMMIT;

-- ===========================================================================
-- VERIFICAÇÃO (rodar separado, com SET app.clinica_id):
--   SET app.clinica_id = '2';   -- Bella
--   SELECT count(*) FROM produtos;            -- só da clínica setada
--   RESET app.clinica_id; SELECT count(*) FROM produtos;  -- 0 (fail-closed)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- SEED de teste (clínica Bella = 2) — idempotente. Remover/ajustar em prod.
-- ---------------------------------------------------------------------------
-- (rodar com SET app.clinica_id = '2' por causa do WITH CHECK da RLS)
