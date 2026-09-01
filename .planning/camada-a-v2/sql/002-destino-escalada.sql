-- ============================================================================
-- 002-destino-escalada.sql — Camada A v2, item 3 (§5.4).
--
-- "Estado não é destino." A v1 criou ESCALADO_HUMANO e o reativacao/007 criou a
-- fila; nenhum dos dois criou PRAZO. Escalonamento sem SLA é interfone tocando
-- em sala vazia: tecnicamente o sistema funcionou.
--
-- Depende de: reativacao/007-escalonamentos.sql, agenda-turnos/001 (turnos).
-- Idempotente.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- Os dois botões por tenant. Coluna em `clinicas`, NÃO tenant_config novo: o
-- item 7 do §11 está fora desta fatia e dois valores não justificam a tabela.
-- Quando o item 7 chegar, estas colunas migram para lá.
-- ---------------------------------------------------------------------------
ALTER TABLE clinicas
  ADD COLUMN IF NOT EXISTS sla_escalada_min INTEGER NOT NULL DEFAULT 30;

COMMENT ON COLUMN clinicas.sla_escalada_min IS
  'Minutos até o escalonamento vencer. §12.5 da v2; default 30.';

ALTER TABLE escalonamentos
  ADD COLUMN IF NOT EXISTS prazo_em TIMESTAMPTZ;

-- Trigger e não DEFAULT: o prazo depende do SLA DA CLÍNICA, e um default não
-- consegue ler outra tabela. Fica no banco para valer também para o n8n, que
-- insere via abrir_escalonamento sem passar pelo painel.
CREATE OR REPLACE FUNCTION trg_prazo_escalonamento() RETURNS TRIGGER
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.prazo_em IS NULL THEN
    SELECT NEW.criado_em + (c.sla_escalada_min || ' min')::interval
      INTO NEW.prazo_em
      FROM clinicas c WHERE c.id = NEW.clinica_id;
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS t_prazo_escalonamento ON escalonamentos;
CREATE TRIGGER t_prazo_escalonamento
  BEFORE INSERT ON escalonamentos
  FOR EACH ROW EXECUTE FUNCTION trg_prazo_escalonamento();

-- backfill do que já existe (nenhum em banco novo, mas a migração é idempotente
-- e pode rodar sobre base com histórico)
UPDATE escalonamentos e
   SET prazo_em = e.criado_em + (c.sla_escalada_min || ' min')::interval
  FROM clinicas c
 WHERE c.id = e.clinica_id AND e.prazo_em IS NULL;

-- ---------------------------------------------------------------------------
-- fn_fora_do_horario — fail-closed: clínica SEM turno cadastrado é tratada como
-- FECHADA. O contrário faria a mensagem automática prometer atendimento que
-- ninguém vai dar — que é exatamente o que o §5.4 proíbe.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_fora_do_horario(p_clinica_id INTEGER, p_quando TIMESTAMPTZ DEFAULT NOW())
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $fn$
  SELECT NOT EXISTS (
    SELECT 1
      FROM turnos t
      JOIN clinicas c ON c.id = t.clinica_id
     WHERE t.clinica_id = p_clinica_id
       AND t.ativo
       AND t.dia_semana = EXTRACT(dow FROM (p_quando AT TIME ZONE c.timezone))::smallint
       AND (p_quando AT TIME ZONE c.timezone)::time BETWEEN t.hora_inicio AND t.hora_fim
       AND t.vigencia_inicio <= (p_quando AT TIME ZONE c.timezone)::date
       AND (t.vigencia_fim IS NULL OR t.vigencia_fim >= (p_quando AT TIME ZONE c.timezone)::date)
  );
$fn$;

-- ---------------------------------------------------------------------------
-- A FILA VISÍVEL. Ordena por prazo: quem vence primeiro aparece primeiro — não
-- por chegada, senão um item com SLA curto some atrás de um antigo e folgado.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_fila_escalonamento
  WITH (security_invoker = true) AS
  SELECT e.id, e.clinica_id, e.chat_id, e.contato_id, e.gatilho, e.trecho,
         e.status, e.atendido_por, e.criado_em, e.prazo_em,
         EXTRACT(epoch FROM (NOW() - e.criado_em))::int / 60 AS esperando_min,
         (e.prazo_em IS NOT NULL AND NOW() > e.prazo_em)     AS atrasado
    FROM escalonamentos e
   WHERE e.status <> 'resolvido'
   ORDER BY e.prazo_em ASC NULLS LAST, e.criado_em ASC;

GRANT SELECT ON v_fila_escalonamento TO app_painel;
GRANT EXECUTE ON FUNCTION fn_fora_do_horario(INTEGER, TIMESTAMPTZ) TO app_painel, app_n8n;

COMMIT;
