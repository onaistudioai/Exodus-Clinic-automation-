-- ============================================================================
-- 001-catraca.sql — Camada A, 1º módulo (ex-etapa 5 do rascunho).
--
-- TESE 2: validação é CATRACA, não fiscal. Campo inválido não entra na fila de
-- disparo — não é "sinalizado depois". O risco de maior severidade do sistema
-- (paciente errado / número errado) nasce no preenchimento humano da recepção,
-- não no bot; então a barreira fica onde a recepção escreve, no banco.
--
-- POR QUE VIEW E NÃO COLUNA `apto`: coluna precisaria ser recalculada por trigger
-- em toda a cadeia (paciente, contato, vínculo, agendamento). A view lê o estado
-- corrente e não pode ficar desatualizada. Quem dispara passa a ler v_fila_disparo;
-- não existe caminho de código que veja a tabela crua e mande mensagem.
--
-- Depende de: schema base (pacientes, contatos_whatsapp, paciente_contato,
-- agendamentos_sofia_demo), bot-agendamento/001 (papel/nivel, chk_status).
-- Idempotente. Aplicar via sofia-demo/sql/_run-sql.mjs.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- Espelho em SQL de aios-painel/src/lib/telefone.ts (normalizarTelefone).
-- A validação da UI existe só para dar erro cedo; ESTA é a que vale, porque o
-- n8n e qualquer script futuro também escrevem na tabela sem passar pela UI.
-- ponytail: só BR (+55), igual ao TS. Se atender outro país, os dois mudam juntos.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_telefone_valido(p_bruto TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $fn$
  WITH d AS (
    SELECT regexp_replace(split_part(COALESCE(p_bruto,''), '@', 1), '\D', '', 'g') AS s
  ), n AS (
    SELECT CASE WHEN s LIKE '55%' THEN s ELSE '55' || s END AS s FROM d
  )
  SELECT length(s) IN (12, 13)
     AND substring(s, 3, 2)::int BETWEEN 11 AND 99
    FROM n;
$fn$;

-- ---------------------------------------------------------------------------
-- A catraca. Retorna o MOTIVO da recusa (NULL = passou) em vez de um booleano:
-- sem o motivo, "40 registros barrados" não diz à recepção o que corrigir, e a
-- métrica do §9 vira um número sem ação.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_motivo_barrado(p_agendamento_id INTEGER)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $fn$
DECLARE a RECORD;
BEGIN
  SELECT ag.id, ag.paciente_id, ag.inicio, ag.status, ag.contato_origem_id,
         p.nome_completo, p.status AS paciente_status
    INTO a
    FROM agendamentos_sofia_demo ag
    LEFT JOIN pacientes p ON p.id = ag.paciente_id
   WHERE ag.id = p_agendamento_id;

  IF NOT FOUND                                   THEN RETURN 'agendamento_inexistente'; END IF;
  IF a.paciente_id IS NULL                       THEN RETURN 'sem_paciente';            END IF;
  IF a.paciente_status <> 'ativo'                THEN RETURN 'paciente_inativo';        END IF;
  IF COALESCE(btrim(a.nome_completo), '') = ''   THEN RETURN 'nome_vazio';              END IF;
  IF a.inicio IS NULL                            THEN RETURN 'sem_horario';             END IF;
  IF a.inicio <= NOW()                           THEN RETURN 'horario_no_passado';      END IF;

  -- Destinatário: precisa existir UM contato ativo, com telefone válido e vínculo
  -- vigente com ESTE paciente. Sem isso a mensagem sai para o número de ninguém.
  IF NOT EXISTS (
    SELECT 1
      FROM paciente_contato pc
      JOIN contatos_whatsapp c ON c.id = pc.contato_id
     WHERE pc.paciente_id = a.paciente_id
       AND pc.vinculo_status = 'ativo'
       AND c.status = 'ativo'
       AND fn_telefone_valido(COALESCE(c.telefone, c.chat_id))
  ) THEN RETURN 'sem_contato_valido'; END IF;

  RETURN NULL;  -- passou na catraca
END;
$fn$;

CREATE OR REPLACE FUNCTION fn_agendamento_apto_disparo(p_agendamento_id INTEGER)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $fn$
  SELECT fn_motivo_barrado(p_agendamento_id) IS NULL;
$fn$;

-- ---------------------------------------------------------------------------
-- A FILA. Quem dispara lê daqui, nunca da tabela.
-- security_invoker: sem ele a view rodaria com os direitos do DONO e app_painel
-- enxergaria todas as clinicas (mesmo furo documentado em prontuario/001-fronteira).
-- Ordem: por horário ASC (decisão §12.2 — gravidade não sai do banco, tese 3).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_fila_disparo
  WITH (security_invoker = true) AS
  SELECT ag.id AS agendamento_id, ag.clinica_id, ag.paciente_id, ag.inicio, ag.status
    FROM agendamentos_sofia_demo ag
   WHERE ag.status IN ('agendada','reservada','confirmada')
     AND fn_motivo_barrado(ag.id) IS NULL
   ORDER BY ag.inicio ASC;

-- Métrica §9 "registros barrados na validação" + lista de trabalho da recepção.
CREATE OR REPLACE VIEW v_barrados_validacao
  WITH (security_invoker = true) AS
  SELECT ag.id AS agendamento_id, ag.clinica_id, ag.inicio,
         fn_motivo_barrado(ag.id) AS motivo
    FROM agendamentos_sofia_demo ag
   WHERE ag.status IN ('agendada','reservada','confirmada')
     AND fn_motivo_barrado(ag.id) IS NOT NULL;

GRANT SELECT ON v_fila_disparo, v_barrados_validacao TO app_painel, app_n8n;
GRANT EXECUTE ON FUNCTION fn_telefone_valido(TEXT),
                          fn_motivo_barrado(INTEGER),
                          fn_agendamento_apto_disparo(INTEGER) TO app_painel, app_n8n;

COMMIT;
