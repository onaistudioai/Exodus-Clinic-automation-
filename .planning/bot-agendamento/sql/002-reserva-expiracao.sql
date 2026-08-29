-- ============================================================================
-- 002-reserva-expiracao.sql — spec v1.2: expiração de reserva e bordas.
--
-- Síntese da spec 0.1 com o que já está no ar:
--   PREGUIÇOSO PARA RECUSAR  — confirmar() checa o vencimento por cálculo e não
--                              espera o job. Fecha a janela em que uma reserva
--                              vencida ainda podia ser confirmada.
--   MATERIALIZADO PARA LIBERAR — o predicado da constraint anti-overbooking usa
--                              `status`, porque o Postgres recusa `now()` em
--                              predicado de índice ("functions in index predicate
--                              must be marked IMMUTABLE" — verificado em PG 18.6).
--                              Sem coluna gravada não há invariante atômico.
--
-- Invariante 5 da spec 0.1 ("nenhum estado derivável é armazenado") fica como:
-- derivado de dado IMUTÁVEL pode ser gravado — nunca desatualiza. reserva_expira_em
-- é função de criado_em e inicio, ambos imutáveis.
-- Idempotente. Aplicar depois de 001.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- A.1 — prazo variável. Uma função, não uma constante espalhada.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_prazo_retencao(
  p_criada    TIMESTAMPTZ,
  p_inicio    TIMESTAMPTZ,
  p_base      INTERVAL DEFAULT INTERVAL '30 min',
  p_divisor   INT      DEFAULT 2
) RETURNS TIMESTAMPTZ IMMUTABLE LANGUAGE sql AS $fn$
  SELECT p_criada + LEAST(p_base, (p_inicio - p_criada) / p_divisor);
$fn$;
COMMENT ON FUNCTION fn_prazo_retencao IS
  'A.1: prazo = min(PRAZO_BASE, tempo_ate_consulta/DIVISOR). IMMUTABLE porque as '
  'duas entradas são imutáveis — por isso o resultado pode ser gravado.';

-- PISO_RESERVA: abaixo disso não se aceita provisória (exige confirmação imediata).
CREATE OR REPLACE FUNCTION fn_pode_reservar(
  p_inicio TIMESTAMPTZ, p_piso INTERVAL DEFAULT INTERVAL '15 min'
) RETURNS BOOLEAN STABLE LANGUAGE sql AS $fn$
  SELECT p_inicio - NOW() >= p_piso;
$fn$;

-- ---------------------------------------------------------------------------
-- M2 — cancelamento vira UM tipo + origem, não dois tipos.
-- `origem` já existia; manter cancelado_paciente/cancelado_clinica duplicava a
-- informação e permitia que as duas discordassem.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
              WHERE t.typname = 'tipo_evento' AND e.enumlabel = 'cancelado_paciente') THEN
    CREATE TYPE tipo_evento_v2 AS ENUM ('criado','reservado','confirmado','expirado',
      'cancelado','compareceu','faltou','remarcado');
    ALTER TABLE eventos_agendamento ALTER COLUMN tipo TYPE tipo_evento_v2
      USING (CASE WHEN tipo::text LIKE 'cancelado%' THEN 'cancelado' ELSE tipo::text END)::tipo_evento_v2;
    DROP TYPE tipo_evento;
    ALTER TYPE tipo_evento_v2 RENAME TO tipo_evento;
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- D2 e D3 — idempotência sem tabela de chaves. O log é append-only, então um
-- índice único parcial já garante "um único evento terminal por agendamento".
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_evt_terminal
  ON eventos_agendamento (agendamento_id, tipo)
  WHERE tipo IN ('confirmado','expirado','compareceu','faltou');

-- D4 — lembrete de expiração no máximo uma vez por agendamento.
ALTER TABLE notificacoes_saida
  ADD COLUMN IF NOT EXISTS agendamento_id INTEGER REFERENCES agendamentos_sofia_demo(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_por_agendamento
  ON notificacoes_saida (agendamento_id, tipo) WHERE agendamento_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Invariantes 2 e 3 — máquina de estados imposta pelo banco.
-- Sem isto, o CHECK de status aceita ir de 'realizada' para 'reservada'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_transicao_valida(p_de TEXT, p_para TEXT)
RETURNS BOOLEAN IMMUTABLE LANGUAGE sql AS $fn$
  SELECT CASE p_de
    -- terminais: sem saída (invariante 3)
    WHEN 'realizada'  THEN false
    WHEN 'no_show'    THEN false
    WHEN 'cancelada'  THEN false
    WHEN 'expirada'   THEN false
    WHEN 'remarcada'  THEN false
    WHEN 'reservada'  THEN p_para IN ('confirmada','cancelada','expirada')
    WHEN 'agendada'   THEN p_para IN ('confirmada','cancelada','remarcada')
    WHEN 'confirmada' THEN p_para IN ('realizada','no_show','cancelada','remarcada')
    ELSE false
  END;
$fn$;

CREATE OR REPLACE FUNCTION trg_estado_agendamento() RETURNS TRIGGER
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT fn_transicao_valida(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'transição inválida: % -> % (agendamento %)',
      OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END$fn$;

DROP TRIGGER IF EXISTS t_estado_agendamento ON agendamentos_sofia_demo;
CREATE TRIGGER t_estado_agendamento
  BEFORE UPDATE OF status ON agendamentos_sofia_demo
  FOR EACH ROW EXECUTE FUNCTION trg_estado_agendamento();

-- ---------------------------------------------------------------------------
-- A.5 — operações. Vivem no banco porque é onde a transação e a constraint estão.
-- ---------------------------------------------------------------------------

-- confirmar: PREGUIÇOSO. Recusa por cálculo, sem depender do job ter rodado.
CREATE OR REPLACE FUNCTION fn_confirmar_reserva(p_id INT, p_origem origem_evento DEFAULT 'bot')
RETURNS TEXT LANGUAGE plpgsql AS $fn$
DECLARE v_status TEXT; v_expira TIMESTAMPTZ; v_clinica INT;
BEGIN
  SELECT status, reserva_expira_em, clinica_id INTO v_status, v_expira, v_clinica
    FROM agendamentos_sofia_demo WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'inexistente'; END IF;

  -- D2: confirmar já-confirmada é operação sem efeito, não erro.
  IF v_status = 'confirmada' THEN RETURN 'ja_confirmado'; END IF;
  IF v_status <> 'reservada' THEN RETURN 'estado_invalido'; END IF;

  -- C2/E1: a verdade da expiração é calculada. NOW() é estável na transação.
  IF v_expira IS NOT NULL AND NOW() > v_expira THEN RETURN 'expirado'; END IF;

  UPDATE agendamentos_sofia_demo
     SET status = 'confirmada', reserva_expira_em = NULL WHERE id = p_id;
  INSERT INTO eventos_agendamento (clinica_id, agendamento_id, tipo, origem)
    VALUES (v_clinica, p_id, 'confirmado', p_origem);
  RETURN 'confirmado';
END$fn$;

-- expirar: MATERIALIZA. Não decide — grava o que já era verdade e libera o slot.
CREATE OR REPLACE FUNCTION fn_expirar_vencidas() RETURNS INT
LANGUAGE plpgsql AS $fn$
DECLARE v_n INT;
BEGIN
  WITH vencidas AS (
    UPDATE agendamentos_sofia_demo
       SET status = 'expirada'
     WHERE status = 'reservada' AND reserva_expira_em IS NOT NULL
       AND NOW() > reserva_expira_em
    RETURNING id, clinica_id
  ), gravados AS (
    INSERT INTO eventos_agendamento (clinica_id, agendamento_id, tipo, origem)
    SELECT clinica_id, id, 'expirado', 'sistema' FROM vencidas
    ON CONFLICT DO NOTHING          -- D3: sobreposição de jobs não duplica evento
    RETURNING 1
  ) SELECT count(*)::INT INTO v_n FROM gravados;
  RETURN v_n;
END$fn$;

REVOKE ALL ON FUNCTION fn_confirmar_reserva(INT, origem_evento) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_expirar_vencidas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_confirmar_reserva(INT, origem_evento) TO app_painel, app_n8n;
GRANT EXECUTE ON FUNCTION fn_expirar_vencidas() TO app_painel;

COMMIT;
