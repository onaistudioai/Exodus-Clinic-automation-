-- ============================================================================
-- 004-consentimento.sql — Opt-in / opt-out de marketing (LGPD art. 7º/11)
--
-- POR QUÊ: reativação é comunicação de MARKETING para titular de dado sensível
-- (saúde). O atendimento em si está coberto por "tutela da saúde"; campanha de
-- retorno NÃO está. Precisa de base legal registrada, com prova de quando e como.
-- Um booleano mutável não é prova — por isso o consentimento é um LIVRO-RAZÃO
-- append-only, e a coluna em contatos_whatsapp é só o estado corrente (cache).
--
-- ONDE: consentimento é do CANAL (número de WhatsApp), não do paciente. Quem
-- responde "SAIR" é um chat_id; a Meta exige que esse número pare de receber,
-- independente de quantos pacientes estejam vinculados a ele.
--
-- Padrão herdado de 001-reativacao.sql: RLS FORCE + rls_tenant (GUC app.clinica_id,
-- fail-closed), livro-razão append-only via trigger, app_painel/app_n8n NOBYPASSRLS.
-- Aplicar via sofia-demo/sql/_run-sql.mjs. Idempotente.
--
-- ⚠️ BREAKING (intencional): v_reativacao_inativos passa a exigir opt-in TRUE.
--    Sem backfill, a materialização retorna 0. Ver "BACKFILL" no rodapé.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Estado corrente no canal. Tri-estado proposital:
--   NULL  = nunca perguntado  -> fail-closed, não recebe marketing
--   TRUE  = opt-in vigente
--   FALSE = opt-out explícito -> nunca mais, e não volta por reimportação de CSV
-- ---------------------------------------------------------------------------
ALTER TABLE contatos_whatsapp
  ADD COLUMN IF NOT EXISTS marketing_optin        BOOLEAN,
  ADD COLUMN IF NOT EXISTS marketing_optin_em     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_optin_origem TEXT;

COMMENT ON COLUMN contatos_whatsapp.marketing_optin IS
  'NULL=nunca perguntado (fail-closed) | TRUE=opt-in | FALSE=opt-out. Estado corrente; a prova está em consentimento_eventos.';

-- worker/view varrem por opt-in vigente
CREATE INDEX IF NOT EXISTS idx_contatos_optin
  ON contatos_whatsapp (clinica_id) WHERE marketing_optin IS TRUE;

-- ---------------------------------------------------------------------------
-- consentimento_eventos — LIVRO-RAZÃO append-only. É a prova exigida pela ANPD
-- ("demonstrar a obtenção do consentimento", art. 8º §2º) e o histórico que o
-- cliente leva embora na portabilidade.
-- origem: 'whatsapp_sair' | 'whatsapp_confirmacao' | 'painel' | 'importacao_csv'
--         | 'formulario_site' | 'ficha_presencial'
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consentimento_eventos (
  id          BIGSERIAL PRIMARY KEY,
  clinica_id  INTEGER NOT NULL REFERENCES clinicas(id),
  contato_id  INTEGER NOT NULL REFERENCES contatos_whatsapp(id),
  tipo        TEXT NOT NULL CHECK (tipo IN ('optin','optout')),
  origem      TEXT NOT NULL,
  evidencia   TEXT,             -- texto literal recebido, id da msg, ou quem registrou
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consent_contato
  ON consentimento_eventos (clinica_id, contato_id, registrado_em DESC);

-- append-only: prova que pode ser editada não é prova.
CREATE OR REPLACE FUNCTION trg_consent_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'consentimento_eventos é append-only: % proibido.', TG_OP;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS t_consent_append_only ON consentimento_eventos;
CREATE TRIGGER t_consent_append_only
  BEFORE UPDATE OR DELETE ON consentimento_eventos
  FOR EACH ROW EXECUTE FUNCTION trg_consent_append_only();

-- ===========================================================================
-- RLS — fail-closed + FORCE, igual às demais.
-- ===========================================================================
ALTER TABLE consentimento_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE consentimento_eventos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_tenant ON consentimento_eventos;
CREATE POLICY rls_tenant ON consentimento_eventos
  USING (clinica_id = NULLIF(current_setting('app.clinica_id', true), '')::int)
  WITH CHECK (clinica_id = NULLIF(current_setting('app.clinica_id', true), '')::int);

-- ===========================================================================
-- registrar_consentimento — PONTO ÚNICO de escrita. SOFIA (n8n), painel e
-- importação de CSV chamam esta função; ninguém escreve na coluna direto.
-- Grava o evento (prova) E atualiza o estado corrente na mesma transação.
--
-- REGRA DURA: opt-out é definitivo. Um 'optin' NUNCA sobrescreve um opt-out
-- anterior — só o titular pode voltar atrás, e isso é um UPDATE manual
-- deliberado, não um efeito colateral de reimportar a planilha do cliente.
-- Retorna TRUE se o estado mudou.
-- ===========================================================================
CREATE OR REPLACE FUNCTION registrar_consentimento(
  p_chat_id   TEXT,
  p_tipo      TEXT,
  p_origem    TEXT,
  p_evidencia TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_contato_id INTEGER;
  v_atual      BOOLEAN;
  v_novo       BOOLEAN;
BEGIN
  IF p_tipo NOT IN ('optin','optout') THEN
    RAISE EXCEPTION 'tipo inválido: %', p_tipo;
  END IF;
  v_novo := (p_tipo = 'optin');

  SELECT id, marketing_optin INTO v_contato_id, v_atual
    FROM contatos_whatsapp
   WHERE chat_id = p_chat_id
     AND clinica_id = current_setting('app.clinica_id')::int;

  IF v_contato_id IS NULL THEN
    RAISE EXCEPTION 'contato % não encontrado nesta clínica', p_chat_id;
  END IF;

  -- opt-out é porta de mão única.
  IF v_novo AND v_atual IS FALSE THEN
    RETURN false;
  END IF;

  INSERT INTO consentimento_eventos (clinica_id, contato_id, tipo, origem, evidencia)
  VALUES (current_setting('app.clinica_id')::int, v_contato_id, p_tipo, p_origem, p_evidencia);

  UPDATE contatos_whatsapp
     SET marketing_optin = v_novo,
         marketing_optin_em = NOW(),
         marketing_optin_origem = p_origem
   WHERE id = v_contato_id;

  -- opt-out encerra qualquer sequência de reativação em curso do(s) paciente(s)
  -- deste número. Sem isso o worker continua mandando por até 21 dias.
  IF NOT v_novo THEN
    UPDATE reativacao_alvos ra
       SET status = 'optout', atualizado_em = NOW()
      WHERE ra.clinica_id = current_setting('app.clinica_id')::int
        AND ra.status = 'ativo'
        AND ra.paciente_id IN (
          SELECT pc.paciente_id FROM paciente_contato pc
           WHERE pc.contato_id = v_contato_id
             AND pc.clinica_id = current_setting('app.clinica_id')::int
        );
  END IF;

  RETURN v_atual IS DISTINCT FROM v_novo;
END; $$ LANGUAGE plpgsql;

-- ===========================================================================
-- v_reativacao_inativos — recriada com o filtro de opt-in.
-- Única mudança vs 001: "AND c.marketing_optin IS TRUE".
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
  AND c.marketing_optin IS TRUE          -- <<< LGPD: fail-closed, NULL não passa
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
-- GRANTS. app_n8n precisa da função (SOFIA detecta "SAIR" no router) e da
-- leitura do estado. Ninguém recebe UPDATE direto na coluna: o caminho é a função.
-- ===========================================================================
GRANT SELECT, INSERT ON consentimento_eventos TO app_painel, app_n8n;
GRANT USAGE, SELECT ON SEQUENCE consentimento_eventos_id_seq TO app_painel, app_n8n;
GRANT EXECUTE ON FUNCTION registrar_consentimento(TEXT,TEXT,TEXT,TEXT) TO app_painel, app_n8n;
GRANT UPDATE (marketing_optin, marketing_optin_em, marketing_optin_origem)
  ON contatos_whatsapp TO app_painel, app_n8n;

COMMIT;

-- ===========================================================================
-- BACKFILL (rodar MANUALMENTE, por clínica, só com base legal documentada).
-- Não está no corpo da migração de propósito: marcar opt-in em massa sem que a
-- clínica tenha declarado a origem do consentimento é exatamente a infração que
-- esta migração existe para impedir. A origem tem que ser verdadeira.
--
--   SET app.clinica_id = '2';
--   SELECT registrar_consentimento(chat_id, 'optin', 'ficha_presencial',
--            'declarado pela clínica na implantação 2026-07-27')
--     FROM contatos_whatsapp
--    WHERE clinica_id = 2 AND marketing_optin IS NULL;
-- ===========================================================================
