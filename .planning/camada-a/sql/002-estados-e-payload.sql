-- ============================================================================
-- 002-estados-e-payload.sql — Camada A, 2º módulo (ex-etapa 3): o motor de
-- confirmação ganha os estados que faltavam e o contrato de privacidade.
--
-- O QUE FALTAVA: o rascunho desenhou só o fluxo feliz. "não", silêncio e
-- ambiguidade não eram estados — eram ausência de estado. Cada um agora tem
-- uma ação definida (§5): recusada libera vaga (só avisa a recepção, §12.4),
-- sem_resposta marca risco de falta, escalado_humano tira o bot do caminho.
--
-- TESE 3 (reduzir severidade, não probabilidade): fn_payload_lembrete é o
-- ENVELOPE LACRADO. Nenhum caminho de código monta mensagem a partir de
-- SELECT * — o n8n chama a função e recebe só as 4 chaves publicáveis.
-- Campo clínico não tem rota até o WhatsApp; erro de destinatário deixa de ser
-- vazamento de dado de saúde e vira lembrete para a pessoa errada.
--
-- Depende de: bot-agendamento/001 (chk_status_agendamento, tipo_evento,
-- eventos_agendamento). Idempotente.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- ESTADOS (§5). Reescreve o CHECK de bot-agendamento/001 acrescentando os três.
-- 'recusada' é distinta de 'cancelada': cancelada é ato da clínica, recusada é
-- resposta negativa do paciente — e só a segunda vira métrica de comunicação.
-- ---------------------------------------------------------------------------
ALTER TABLE agendamentos_sofia_demo DROP CONSTRAINT IF EXISTS chk_status_agendamento;
ALTER TABLE agendamentos_sofia_demo ADD CONSTRAINT chk_status_agendamento
  CHECK (status IN ('reservada','agendada','confirmada','cancelada','remarcada',
                    'realizada','no_show','expirada',
                    'recusada','sem_resposta','escalado_humano'));

-- ---------------------------------------------------------------------------
-- A MÁQUINA DE TRANSIÇÕES precisa aprender os estados novos.
--
-- bot-agendamento/002 impõe `fn_transicao_valida` por trigger, com `ELSE false`.
-- Acrescentar valores só ao CHECK deixa os três novos INALCANÇÁVEIS e cria dois
-- bugs que um teste isolado não vê:
--   1. `escalado_humano` vira beco sem saída — nunca mais confirma nem cancela;
--   2. t_escala_por_falhas roda ANTES de t_estado_agendamento (ordem alfabética),
--      então a escalada automática levantaria exceção e quebraria todo UPDATE de
--      falhas_classificacao.
--   3. `recusada` inalcançável = fila reversa nunca dispara.
-- Quem acrescenta estado ensina a máquina. Descoberto ao aplicar em produção.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  PERFORM 1 FROM pg_proc WHERE proname = 'fn_transicao_valida';
  IF FOUND THEN
    CREATE OR REPLACE FUNCTION fn_transicao_valida(p_de TEXT, p_para TEXT)
    RETURNS BOOLEAN IMMUTABLE LANGUAGE sql AS $fn$
      SELECT CASE
        -- escalar é sempre permitido a partir de qualquer estado vivo: o bot
        -- desistir nunca pode ser bloqueado por regra de fluxo.
        WHEN p_para = 'escalado_humano'
             AND p_de NOT IN ('realizada','no_show','cancelada','expirada','remarcada')
          THEN true
        ELSE CASE p_de
          -- terminais: sem saída (invariante 3 da spec do bot)
          WHEN 'realizada'  THEN false
          WHEN 'no_show'    THEN false
          WHEN 'cancelada'  THEN false
          WHEN 'expirada'   THEN false
          WHEN 'remarcada'  THEN false
          -- recusada é terminal PARA O AGENDAMENTO: a vaga segue em ofertas_vaga,
          -- não reaproveitando a mesma linha.
          WHEN 'recusada'   THEN false
          WHEN 'reservada'  THEN p_para IN ('confirmada','cancelada','expirada','recusada')
          WHEN 'agendada'   THEN p_para IN ('confirmada','cancelada','remarcada','recusada','sem_resposta')
          WHEN 'confirmada' THEN p_para IN ('realizada','no_show','cancelada','remarcada')
          -- silêncio não é fim: o paciente pode responder depois do H-1.
          WHEN 'sem_resposta' THEN p_para IN ('confirmada','cancelada','remarcada','no_show','recusada')
          -- volta da fila humana: alguém resolveu e o fluxo continua.
          WHEN 'escalado_humano' THEN p_para IN ('confirmada','cancelada','remarcada','recusada','agendada')
          ELSE false
        END
      END;
    $fn$;
  END IF;
END $$;

DO $$ BEGIN ALTER TYPE tipo_evento ADD VALUE IF NOT EXISTS 'recusado';     EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE tipo_evento ADD VALUE IF NOT EXISTS 'sem_resposta'; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE tipo_evento ADD VALUE IF NOT EXISTS 'escalado';     EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- ESCALADA (§12.3: 2 falhas). O contador vive no agendamento e a transição é do
-- BANCO, não de cada chamador: n8n, painel e qualquer script futuro escalam pelo
-- mesmo caminho. Remendar em cada chamador deixaria os irmãos quebrados.
-- ---------------------------------------------------------------------------
ALTER TABLE agendamentos_sofia_demo
  ADD COLUMN IF NOT EXISTS falhas_classificacao SMALLINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION trg_escala_por_falhas() RETURNS TRIGGER
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.falhas_classificacao >= 2
     AND NEW.status NOT IN ('escalado_humano','cancelada','realizada','no_show','expirada') THEN
    NEW.status := 'escalado_humano';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS t_escala_por_falhas ON agendamentos_sofia_demo;
CREATE TRIGGER t_escala_por_falhas
  BEFORE UPDATE OF falhas_classificacao ON agendamentos_sofia_demo
  FOR EACH ROW EXECUTE FUNCTION trg_escala_por_falhas();

-- O evento correspondente, para a trilha do §5 ficar completa no livro-razão.
CREATE OR REPLACE FUNCTION trg_evento_escalado() RETURNS TRIGGER
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.status = 'escalado_humano' AND OLD.status IS DISTINCT FROM 'escalado_humano' THEN
    INSERT INTO eventos_agendamento (clinica_id, agendamento_id, tipo, origem, ator)
    VALUES (NEW.clinica_id, NEW.id, 'escalado', 'sistema', 'trg_escala_por_falhas');
  END IF;
  RETURN NULL;
END;
$fn$;
-- SEM `OF status`: um UPDATE de falhas_classificacao escala pelo trigger BEFORE
-- acima, mas `AFTER UPDATE OF status` NÃO dispararia — a cláusula OF olha as
-- colunas do SET, não o que o BEFORE mudou. Com a lista, a escalada automática
-- (o caminho normal) nunca entraria no livro-razão. Provado pelo teste (5c).
DROP TRIGGER IF EXISTS t_evento_escalado ON agendamentos_sofia_demo;
CREATE TRIGGER t_evento_escalado
  AFTER UPDATE ON agendamentos_sofia_demo
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION trg_evento_escalado();

-- ---------------------------------------------------------------------------
-- CONTRATO DE PAYLOAD (§4.3) — o envelope lacrado.
-- Devolve EXATAMENTE {nome, data_hora, unidade, profissional}. Nada de
-- procedimento, servico, gravidade ou qualquer texto clínico.
-- SECURITY INVOKER: a RLS do chamador continua valendo; a função não é uma porta
-- lateral para ler agendamento de outra clínica.
-- Chamador barrado pela catraca recebe NULL — a fila e o envelope concordam.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_payload_lembrete(p_agendamento_id INTEGER)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $fn$
DECLARE r JSONB;
BEGIN
  IF fn_motivo_barrado(p_agendamento_id) IS NOT NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
           'nome',         p.nome_completo,
           'data_hora',    to_char(ag.inicio AT TIME ZONE c.timezone, 'DD/MM/YYYY HH24:MI'),
           'unidade',      c.nome,
           'profissional', COALESCE(pr.nome, ag.profissional_legado)
         )
    INTO r
    FROM agendamentos_sofia_demo ag
    JOIN pacientes p  ON p.id = ag.paciente_id
    JOIN clinicas  c  ON c.id = ag.clinica_id
    LEFT JOIN profissionais pr ON pr.id = ag.profissional_id
   WHERE ag.id = p_agendamento_id;

  RETURN r;
END;
$fn$;

GRANT EXECUTE ON FUNCTION fn_payload_lembrete(INTEGER) TO app_painel, app_n8n;

COMMIT;
