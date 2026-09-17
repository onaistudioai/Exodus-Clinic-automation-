-- ============================================================================
-- 004-telemetria.sql — Camada A, 4º módulo (ex-etapa 1): a camada de observação.
--
-- TESE 4 — a dúvida repetida denuncia a mensagem anterior. A métrica útil não é
-- "quantas dúvidas de preço tivemos", é "QUAL MENSAGEM produziu essa dúvida".
-- Isso é impossível sem versionar o que sai: por isso `templates` e
-- template_id em tudo que é enviado.
--
-- TESE 5 — etiqueta no check-in, não na esteira. `intencao` deixa de ser TEXT
-- livre e vira o enum fechado do §8; reprocessar histórico recupera texto e
-- nada de contexto, então a etiqueta é obrigatória no momento do evento.
--
-- Depende de: bot-agendamento/001 (mensagens_bot, interacoes, notificacoes_saida).
-- Idempotente.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- TEMPLATES — fonte única dos textos que hoje estão hardcoded nos JSON do n8n.
-- (chave, versao) é a identidade; `ativo` parcial-único garante que existe no
-- máximo UMA versão vigente por chave, senão "o template v3" é ambíguo.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS templates (
  id         SERIAL PRIMARY KEY,
  clinica_id INTEGER NOT NULL REFERENCES clinicas(id),
  chave      TEXT NOT NULL,              -- ex.: 'lembrete_d1', 'confirmacao_inicial'
  versao     INTEGER NOT NULL,
  corpo      TEXT NOT NULL,
  ativo      BOOLEAN NOT NULL DEFAULT true,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinica_id, chave, versao)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_template_ativo
  ON templates (clinica_id, chave) WHERE ativo;

ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_tenant ON templates;
CREATE POLICY rls_tenant ON templates
  USING (clinica_id = NULLIF(current_setting('app.clinica_id', true), '')::int)
  WITH CHECK (clinica_id = NULLIF(current_setting('app.clinica_id', true), '')::int);

-- ---------------------------------------------------------------------------
-- O ELO. Sem estas duas colunas o cruzamento do §9 é impossível.
-- ---------------------------------------------------------------------------
ALTER TABLE mensagens_bot
  ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES templates(id);
ALTER TABLE notificacoes_saida
  ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES templates(id);
CREATE INDEX IF NOT EXISTS idx_msg_template ON mensagens_bot (template_id) WHERE template_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- TAXONOMIA (§8). Enum fechado: 'ambigua' é a etiqueta que escala para humano.
-- interacoes.intencao era TEXT livre — texto livre não agrega, fragmenta.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE intencao_msg AS ENUM (
    'confirmacao_positiva','confirmacao_negativa','pedido_remarcacao',
    'duvida_preco','duvida_procedimento','duvida_horario','duvida_localizacao',
    'duvida_convenio','reclamacao','fora_de_escopo','spam','ambigua');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Valor fora da taxonomia vira 'ambigua' (escala) em vez de derrubar a migração:
-- perder a etiqueta de uma linha antiga é aceitável; perder a linha não é.
-- Guardado: na 2ª execução a coluna JÁ é o enum, e aí o `= ANY(text[])` do USING
-- não tem operador — a migração morreria só por rodar duas vezes.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'interacoes' AND column_name = 'intencao'
                AND data_type <> 'USER-DEFINED') THEN
    ALTER TABLE interacoes
      ALTER COLUMN intencao TYPE intencao_msg
      USING (CASE WHEN intencao = ANY (enum_range(NULL::intencao_msg)::text[])
                  THEN intencao ELSE 'ambigua' END)::intencao_msg;
  END IF;
END $$;

-- Toda mensagem RECEBIDA recebe exatamente uma etiqueta, no momento do evento.
ALTER TABLE mensagens_bot
  ADD COLUMN IF NOT EXISTS intencao intencao_msg;

-- ---------------------------------------------------------------------------
-- §9 — A LEITURA QUE IMPORTA: intenção recebida × template que a antecedeu.
-- "Muita gente pergunta preço" vira "o lembrete_d1 v3 precisa citar faixa".
-- Antecedeu = último template enviado ao mesmo contato antes da resposta.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_intencao_por_template
  WITH (security_invoker = true) AS
  SELECT t.chave, t.versao, e.intencao, count(*) AS respostas
    FROM mensagens_bot e
    JOIN LATERAL (
      SELECT s.template_id FROM mensagens_bot s
       WHERE s.contato_id = e.contato_id AND s.direcao = 'saida'
         AND s.template_id IS NOT NULL AND s.ocorrido_em < e.ocorrido_em
       ORDER BY s.ocorrido_em DESC LIMIT 1
    ) ant ON TRUE
    JOIN templates t ON t.id = ant.template_id
   WHERE e.direcao = 'entrada' AND e.intencao IS NOT NULL
   GROUP BY t.chave, t.versao, e.intencao;

-- §9 conversão: lead -> agendado -> confirmado -> compareceu.
CREATE OR REPLACE VIEW v_funil
  WITH (security_invoker = true) AS
  SELECT c.clinica_id, c.origem,
         count(*)                                                        AS leads,
         count(*) FILTER (WHERE c.estado_lead = 'convertido')            AS convertidos,
         count(ag.id)                                                    AS agendados,
         count(ag.id) FILTER (WHERE ag.status = 'confirmada')            AS confirmados,
         count(ag.id) FILTER (WHERE ag.status = 'realizada')             AS compareceram,
         count(ag.id) FILTER (WHERE ag.status IN ('no_show','sem_resposta')) AS faltaram
    FROM contatos_whatsapp c
    LEFT JOIN agendamentos_sofia_demo ag ON ag.contato_origem_id = c.id
   GROUP BY c.clinica_id, c.origem;

-- §10 — o maior item de COGS. Mensagem de saída sem entrada do mesmo contato nas
-- 24h anteriores cai FORA da janela do WhatsApp = template cobrado por unidade.
-- Este número entra no preço ANTES de qualquer contrato assinado.
CREATE OR REPLACE VIEW v_custo_disparo
  WITH (security_invoker = true) AS
  SELECT s.clinica_id,
         date_trunc('month', s.ocorrido_em) AS mes,
         count(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM mensagens_bot r
            WHERE r.contato_id = s.contato_id AND r.direcao = 'entrada'
              AND r.ocorrido_em BETWEEN s.ocorrido_em - interval '24 hours' AND s.ocorrido_em
         )) AS fora_da_janela_cobradas,
         count(*) AS total_saidas
    FROM mensagens_bot s
   WHERE s.direcao = 'saida'
   GROUP BY s.clinica_id, date_trunc('month', s.ocorrido_em);

GRANT SELECT, INSERT, UPDATE ON templates TO app_painel;
GRANT SELECT ON templates TO app_n8n;
GRANT USAGE, SELECT ON SEQUENCE templates_id_seq TO app_painel;
GRANT SELECT ON v_intencao_por_template, v_funil, v_custo_disparo TO app_painel;

COMMIT;
