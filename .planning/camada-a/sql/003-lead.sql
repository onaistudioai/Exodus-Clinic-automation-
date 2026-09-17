-- ============================================================================
-- 003-lead.sql — Camada A, 3º módulo (ex-etapa 2): a entrada de funil.
--
-- TESE 1 — lead e paciente são duas entidades. NÃO criamos tabela `lead`:
-- contatos_whatsapp JÁ é a entidade de marketing (é dela a chave de contato e
-- já carrega marketing_optin/consentimento_eventos desde reativacao/004). Uma
-- segunda tabela duplicaria a chave de contato e criaria dois lugares para o
-- opt-out — que é exatamente o que a Meta e a ANPD não perdoam.
--
-- A separação se prova por PRIVILÉGIO, não por tabela: quem faz marketing lê
-- v_leads e NÃO tem grant nenhum em pacientes/prontuário. Caderno da portaria e
-- prontuário continuam sendo dois cadernos, mesmo compartilhando o telefone.
--
-- Depende de: reativacao/004-consentimento.sql. Idempotente.
-- ============================================================================
BEGIN;

ALTER TABLE contatos_whatsapp
  ADD COLUMN IF NOT EXISTS nome_lead   TEXT,
  ADD COLUMN IF NOT EXISTS origem      TEXT CHECK (origem IN ('instagram','google','indicacao','organico')),
  ADD COLUMN IF NOT EXISTS interesse   TEXT,
  ADD COLUMN IF NOT EXISTS segmento    TEXT,
  ADD COLUMN IF NOT EXISTS estado_lead TEXT NOT NULL DEFAULT 'novo'
    CHECK (estado_lead IN ('novo','qualificando','descartado','convertido'));

COMMENT ON COLUMN contatos_whatsapp.interesse IS
  'Procedimento GENÉRICO declarado no funil (ex.: "clareamento"). NUNCA detalhe clínico, gravidade ou diagnóstico — este campo é lido pelo papel de marketing.';

CREATE INDEX IF NOT EXISTS idx_contatos_estado_lead
  ON contatos_whatsapp (clinica_id, estado_lead) WHERE estado_lead <> 'convertido';

-- ---------------------------------------------------------------------------
-- A superfície de marketing. security_invoker mantém a RLS de tenant valendo;
-- a lista de colunas é o que impede o funil de enxergar dado de saúde.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_leads
  WITH (security_invoker = true) AS
  SELECT c.id, c.clinica_id, c.telefone, c.nome_lead, c.origem, c.interesse,
         c.segmento, c.estado_lead, c.marketing_optin, c.marketing_optin_em,
         c.criado_em
    FROM contatos_whatsapp c;

-- ---------------------------------------------------------------------------
-- app_marketing — role de disparo promocional. É a prova executável da tese 1:
-- se alguém der GRANT em pacientes para este role, o contract-test quebra.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_marketing') THEN
    CREATE ROLE app_marketing LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
  EXECUTE format('GRANT app_marketing TO %I', current_user);  -- p/ o contract-test poder SET ROLE
END $$;

GRANT USAGE ON SCHEMA public TO app_marketing;
GRANT SELECT ON v_leads TO app_marketing;
REVOKE ALL ON pacientes FROM app_marketing;
GRANT SELECT ON v_leads TO app_painel, app_n8n;

-- ---------------------------------------------------------------------------
-- RETENÇÃO (§12.5: 180 dias). Molde de fn_expurgo_mensagens (bot-agendamento/001).
-- Só apaga lead que nunca virou paciente e nunca deu opt-in — quem tem vínculo
-- com ficha é dado de atendimento e obedece a outra régua de retenção.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_expurgo_leads(p_dias INT DEFAULT 180)
RETURNS INT LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  WITH x AS (
    UPDATE contatos_whatsapp
       SET nome_lead = NULL, interesse = NULL, segmento = NULL, estado_lead = 'descartado'
     WHERE marketing_optin IS NOT TRUE
       AND estado_lead <> 'convertido'
       AND criado_em < NOW() - (p_dias || ' days')::interval
       AND NOT EXISTS (SELECT 1 FROM paciente_contato pc WHERE pc.contato_id = contatos_whatsapp.id)
    RETURNING 1
  ) SELECT COUNT(*)::INT FROM x;
$fn$;
REVOKE ALL ON FUNCTION fn_expurgo_leads(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_expurgo_leads(INT) TO app_painel;

COMMIT;
