-- ============================================================================
-- 001-reativacao.sql — Módulo Reativação (AIOS.clinic / aios-painel)
-- Fase 2 / Wave 1 / P1 (OPUS). Multi-tenant: clinica_id NOT NULL + FK clinicas.
-- Padrão herdado fielmente de 001-estoque.sql:
--   - RLS FORCE + policy rls_tenant (GUC app.clinica_id, fail-closed)
--   - livro-razão append-only via trigger (reativacao_envios, igual movimentacoes_estoque)
--   - role de app: app_painel (NÃO-dono, NOBYPASSRLS); sem UPDATE/DELETE no livro-razão
-- Decisões (config.json): janela_dias default 30; passos D+0,D+7,D+21; opt-out v1 via
--   paciente_contato.revogado_em; envio dry-run default.
-- Aplicar via runner sofia-demo/sql/_run-sql.mjs. Idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- reativacao_campanhas — cadência por clínica.
-- passos: jsonb array [{offset_dias:int, template:text}] em ordem de envio.
-- 1 campanha ATIVA por clínica (unique parcial).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reativacao_campanhas (
  id            SERIAL PRIMARY KEY,
  clinica_id    INTEGER NOT NULL REFERENCES clinicas(id),
  nome          TEXT NOT NULL,
  janela_dias   INTEGER NOT NULL DEFAULT 30,
  passos        JSONB NOT NULL DEFAULT
                  '[{"offset_dias":0,"template":"Oi {nome}! Sentimos sua falta na {clinica}. Quer agendar um retorno?"},
                    {"offset_dias":7,"template":"{nome}, ainda dá tempo de cuidar da sua saúde — responda aqui que a gente agenda pra você."},
                    {"offset_dias":21,"template":"{nome}, última lembrança 💙 Estamos com horários abertos essa semana. Posso reservar um pra você?"}]'::jsonb,
  ativa         BOOLEAN NOT NULL DEFAULT false,
  criado_em     TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_janela_dias_pos CHECK (janela_dias > 0),
  CONSTRAINT chk_passos_array CHECK (jsonb_typeof(passos) = 'array')
);
-- no máximo 1 campanha ativa por clínica
CREATE UNIQUE INDEX IF NOT EXISTS uq_campanha_ativa_por_clinica
  ON reativacao_campanhas (clinica_id) WHERE ativa = true;

-- ---------------------------------------------------------------------------
-- reativacao_alvos — paciente dentro de uma sequência.
-- passo_atual = índice do PRÓXIMO passo a enviar (0-based); proximo_envio = quando.
-- 1 sequência ATIVA por paciente (unique parcial) — anti-duplicata.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reativacao_alvos (
  id            SERIAL PRIMARY KEY,
  clinica_id    INTEGER NOT NULL REFERENCES clinicas(id),
  campanha_id   INTEGER NOT NULL REFERENCES reativacao_campanhas(id),
  paciente_id   INTEGER NOT NULL REFERENCES pacientes(id),
  contato_id    INTEGER REFERENCES contatos_whatsapp(id),
  passo_atual   INTEGER NOT NULL DEFAULT 0,
  proximo_envio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        TEXT NOT NULL DEFAULT 'ativo'
                  CHECK (status IN ('ativo','reativado','optout','concluido')),
  entrou_em     TIMESTAMPTZ DEFAULT NOW(),
  reativado_em  TIMESTAMPTZ,
  atualizado_em TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_passo_nao_neg CHECK (passo_atual >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_alvo_ativo_por_paciente
  ON reativacao_alvos (clinica_id, paciente_id) WHERE status = 'ativo';
-- worker seleciona alvos vencidos rapidamente
CREATE INDEX IF NOT EXISTS idx_alvos_due
  ON reativacao_alvos (clinica_id, proximo_envio) WHERE status = 'ativo';

-- ---------------------------------------------------------------------------
-- reativacao_envios — LIVRO-RAZÃO append-only do que foi (ou seria) enviado.
-- modo: 'dry' (simulado, default) | 'live' (enviado de verdade pela WAHA).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reativacao_envios (
  id          BIGSERIAL PRIMARY KEY,
  clinica_id  INTEGER NOT NULL REFERENCES clinicas(id),
  alvo_id     INTEGER NOT NULL REFERENCES reativacao_alvos(id),
  passo       INTEGER NOT NULL,
  modo        TEXT NOT NULL CHECK (modo IN ('dry','live')),
  wa_status   TEXT,           -- 'simulado' | 'ok' | 'erro'
  wa_erro     TEXT,
  enviado_em  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_passo_envio_nao_neg CHECK (passo >= 0)
);
CREATE INDEX IF NOT EXISTS idx_envios_alvo
  ON reativacao_envios (clinica_id, alvo_id, enviado_em DESC);
-- idempotência de envio REAL: nunca manda o mesmo passo 2× de verdade.
CREATE UNIQUE INDEX IF NOT EXISTS uq_envio_live_por_passo
  ON reativacao_envios (alvo_id, passo) WHERE modo = 'live';

-- append-only: o livro-razão de envios NUNCA é alterado/apagado.
CREATE OR REPLACE FUNCTION trg_envios_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'reativacao_envios é append-only: % proibido.', TG_OP;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS t_envios_append_only ON reativacao_envios;
CREATE TRIGGER t_envios_append_only
  BEFORE UPDATE OR DELETE ON reativacao_envios
  FOR EACH ROW EXECUTE FUNCTION trg_envios_append_only();

-- ===========================================================================
-- RLS — fail-closed (sem GUC -> NULL -> 0 linhas), FORCE (nem o dono escapa).
-- ===========================================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'reativacao_campanhas','reativacao_alvos','reativacao_envios'
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
-- v_reativacao_inativos — pacientes ELEGÍVEIS (sem o filtro de janela_dias, que
-- é por-campanha e aplicado pelo caller). security_invoker p/ respeitar a RLS de
-- pacientes/paciente_contato/contatos_whatsapp/reativacao_* sob app_painel.
-- agendamentos_sofia_demo NÃO tem RLS -> filtra clinica_id explicitamente.
-- Elegível = paciente ativo não-mesclado, com último 'realizada', SEM futuro em
-- aberto, com contato titular não-revogado, e SEM sequência ativa/opt-out.
-- ===========================================================================
CREATE OR REPLACE VIEW v_reativacao_inativos
  WITH (security_invoker = true) AS
WITH ultimo AS (
  SELECT clinica_id, paciente_id, MAX(data_agendamento) AS ultimo_atendimento
    FROM agendamentos_sofia_demo
   WHERE status = 'realizada' AND paciente_id IS NOT NULL
   GROUP BY clinica_id, paciente_id
)
SELECT
  p.clinica_id,
  p.id                                   AS paciente_id,
  p.nome_completo,
  u.ultimo_atendimento,
  (CURRENT_DATE - u.ultimo_atendimento)  AS dias_inativo,
  c.id                                   AS contato_id,
  c.chat_id,
  c.telefone
FROM pacientes p
JOIN ultimo u
  ON u.paciente_id = p.id AND u.clinica_id = p.clinica_id
JOIN paciente_contato pc
  ON pc.paciente_id = p.id AND pc.clinica_id = p.clinica_id
 AND pc.titular = true AND pc.revogado_em IS NULL
JOIN contatos_whatsapp c
  ON c.id = pc.contato_id AND c.clinica_id = p.clinica_id
WHERE p.status = 'ativo'
  AND p.mesclado_para_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM agendamentos_sofia_demo a
     WHERE a.paciente_id = p.id AND a.clinica_id = p.clinica_id
       AND a.status IN ('pendente','confirmada')
       AND a.data_agendamento >= CURRENT_DATE
  )
  AND NOT EXISTS (
    SELECT 1 FROM reativacao_alvos ra
     WHERE ra.paciente_id = p.id AND ra.clinica_id = p.clinica_id
       AND ra.status IN ('ativo','optout')
  );

-- ===========================================================================
-- GRANTS — app_painel (NOBYPASSRLS). Envios: só SELECT+INSERT (append-only).
-- ===========================================================================
GRANT SELECT, INSERT, UPDATE ON reativacao_campanhas TO app_painel;
GRANT SELECT, INSERT, UPDATE ON reativacao_alvos      TO app_painel;
GRANT SELECT, INSERT          ON reativacao_envios     TO app_painel;
GRANT SELECT ON v_reativacao_inativos TO app_painel;
GRANT USAGE, SELECT ON SEQUENCE
  reativacao_campanhas_id_seq, reativacao_alvos_id_seq, reativacao_envios_id_seq
  TO app_painel;

COMMIT;

-- ===========================================================================
-- VERIFICAÇÃO (rodar com SET app.clinica_id):
--   SET app.clinica_id = '2';
--   SELECT count(*) FROM v_reativacao_inativos;     -- elegíveis da Bella
--   RESET app.clinica_id; SELECT count(*) FROM reativacao_alvos;  -- 0 (fail-closed)
-- ===========================================================================
