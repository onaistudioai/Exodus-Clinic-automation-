-- ============================================================================
-- 004-falhas-fixes.sql — Correções da Simulação de Falhas (Estoque)
-- Ref.: aios-painel/.planning/estoque/RELATORIO-SIMULACAO-FALHAS.md
-- Cobre: M1 (reconciliação SUM(mov)=SUM(lotes)) e M3 (sentinela DIVERGENCIA único).
-- A1 (catch vazio) e M2 (BOM tenant-scoped) e M4 (timeouts do pool) são no código.
-- Aplicar via runner sofia-demo/sql/_run-sql.mjs. Idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- M3 — lote sentinela DIVERGENCIA único por (clinica, produto).
-- Sem isto, dois atendimentos simultâneos de um produto SEM lote criam DOIS
-- sentinelas (não há linha p/ FOR UPDATE serializar). O índice único parcial
-- faz o 2º INSERT colidir → a DAL resolve com ON CONFLICT e reusa o mesmo lote.
-- (Não afeta lotes reais: só restringe os de codigo_lote='DIVERGENCIA'.)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_lote_sentinela_divergencia
  ON lotes (clinica_id, produto_id)
  WHERE codigo_lote = 'DIVERGENCIA';

-- ---------------------------------------------------------------------------
-- M1 — reconciliação: o banco NÃO força SUM(mov)=SUM(lotes). Qualquer escritor
-- fora da DAL pode romper a invariante sem o banco perceber. Esta view expõe os
-- produtos divergentes (por clínica) p/ um job/relatório periódico de alerta.
--
-- Observação RLS (CRÍTICO): a view é criada pelo DONO (superuser, que BYPASSA
-- RLS). Sem security_invoker, ela rodaria com os direitos do DONO → app_painel
-- enxergaria TODAS as clínicas (furo de isolamento). `security_invoker = true`
-- (PG 15+) faz a view rodar com os direitos de QUEM consulta: sob app_painel a
-- RLS aplica e ela vê só a clínica do GUC (fail-closed); rodando como dono p/
-- auditoria cross-tenant, vê todas. Isso é proposital.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_reconciliacao_estoque
  WITH (security_invoker = true) AS
WITH mov AS (
  SELECT clinica_id, produto_id, SUM(quantidade) AS soma_mov
    FROM movimentacoes_estoque
   GROUP BY clinica_id, produto_id
),
sal AS (
  SELECT clinica_id, produto_id, SUM(quantidade) AS soma_lotes
    FROM lotes
   GROUP BY clinica_id, produto_id
)
SELECT
  COALESCE(m.clinica_id, s.clinica_id)        AS clinica_id,
  COALESCE(m.produto_id, s.produto_id)        AS produto_id,
  COALESCE(m.soma_mov, 0)                      AS soma_mov,
  COALESCE(s.soma_lotes, 0)                    AS soma_lotes,
  COALESCE(s.soma_lotes, 0) - COALESCE(m.soma_mov, 0) AS divergencia
FROM mov m
FULL OUTER JOIN sal s
  ON m.clinica_id = s.clinica_id AND m.produto_id = s.produto_id
WHERE COALESCE(m.soma_mov, 0) <> COALESCE(s.soma_lotes, 0);

GRANT SELECT ON v_reconciliacao_estoque TO app_painel;

COMMIT;

-- ===========================================================================
-- VERIFICAÇÃO / USO
--   -- Auditoria cross-tenant (como dono):
--   SELECT * FROM v_reconciliacao_estoque;            -- vazio = invariante OK
--   -- Como app_painel (só a clínica do GUC):
--   SET app.clinica_id = '2'; SELECT * FROM v_reconciliacao_estoque;
-- ===========================================================================
