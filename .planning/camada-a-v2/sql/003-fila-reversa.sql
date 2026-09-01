-- ============================================================================
-- 003-fila-reversa.sql — Camada A v2, item 4 (§5.1).
--
-- TESE 6 — a vaga vazia já foi paga. Aluguel, salário e energia daquele horário
-- já saíram do caixa. Não falta paciente; falta avisar em minutos, não em dias.
--
-- DESENHO: cascata de UM POR VEZ com timeout curto, não broadcast. Duas razões,
-- e as duas importam:
--   - custo (§9): broadcast multiplica disparo cobrado por vaga;
--   - conversão: oferta exclusiva com prazo cria escassez real; oferta em massa
--     vira corrida e queima a lista com quem chegou tarde.
--
-- Depende de: camada-a/002 (status 'recusada'), agenda-turnos/001, bot-agendamento/001.
-- Idempotente.
-- ============================================================================
BEGIN;

-- §12.4 da v1, agora bloqueante. Default CONSERVADOR: a fila reversa não dispara
-- sozinha até a clínica ligar. Automatizar oferta é ato explícito, não surpresa.
ALTER TABLE clinicas
  ADD COLUMN IF NOT EXISTS politica_vaga TEXT NOT NULL DEFAULT 'avisa_recepcao'
    CHECK (politica_vaga IN ('avisa_recepcao','automatica'));

-- ---------------------------------------------------------------------------
-- lista_espera (§4.1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lista_espera (
  id                    SERIAL PRIMARY KEY,
  clinica_id            INTEGER NOT NULL REFERENCES clinicas(id),
  paciente_id           INTEGER NOT NULL REFERENCES pacientes(id),
  servico_id            INTEGER NOT NULL REFERENCES servicos(id),
  profissional_id       INTEGER REFERENCES profissionais(id),  -- NULL = qualquer
  disponibilidade       TEXT NOT NULL DEFAULT 'qualquer'
                        CHECK (disponibilidade IN ('manha','tarde','qualquer')),
  ativo                 BOOLEAN NOT NULL DEFAULT true,
  expira_em             DATE,
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- prioridade = ordem de chegada (§12.1). É a única defensável quando um paciente
-- perguntar por que o outro foi chamado antes; por isso `criado_em` É a prioridade,
-- e não existe coluna que alguém possa "ajustar".
CREATE INDEX IF NOT EXISTS idx_espera_fila
  ON lista_espera (clinica_id, servico_id, criado_em) WHERE ativo;
-- um paciente não ocupa duas posições para o mesmo serviço
CREATE UNIQUE INDEX IF NOT EXISTS uq_espera_pac_servico
  ON lista_espera (clinica_id, paciente_id, servico_id) WHERE ativo;

-- ---------------------------------------------------------------------------
-- ofertas_vaga — o livro do que foi oferecido a quem.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ofertas_vaga (
  id              BIGSERIAL PRIMARY KEY,
  clinica_id      INTEGER NOT NULL REFERENCES clinicas(id),
  agendamento_id  INTEGER NOT NULL REFERENCES agendamentos_sofia_demo(id),
  lista_espera_id INTEGER NOT NULL REFERENCES lista_espera(id),
  enviada_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_em       TIMESTAMPTZ NOT NULL,
  resposta        TEXT CHECK (resposta IN ('aceite','recusa','timeout')),
  respondida_em   TIMESTAMPTZ
);
-- A INVARIANTE DA CASCATA: no máximo UMA oferta pendente por vaga. É isto que
-- impede o broadcast acidental — não a disciplina de quem chama a função.
CREATE UNIQUE INDEX IF NOT EXISTS uq_oferta_pendente_por_vaga
  ON ofertas_vaga (agendamento_id) WHERE resposta IS NULL;
-- ninguém recebe a mesma vaga duas vezes (§12.3, teto de contato)
CREATE UNIQUE INDEX IF NOT EXISTS uq_oferta_por_candidato
  ON ofertas_vaga (agendamento_id, lista_espera_id);
CREATE INDEX IF NOT EXISTS idx_oferta_expirando
  ON ofertas_vaga (expira_em) WHERE resposta IS NULL;

-- ---------------------------------------------------------------------------
-- RLS — padrão herdado de 001-reativacao.sql.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lista_espera','ofertas_vaga'] LOOP
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

-- ---------------------------------------------------------------------------
-- fn_proxima_oferta — o coração da cascata. Escolhe o próximo compatível e cria
-- UMA oferta. Devolve o id da oferta, ou NULL quando a fila esgotou.
--
-- COMPATIBILIDADE é regra, não refinamento: oferecer vaga de ortodontia a quem
-- espera clareamento queima a lista inteira em uma semana. Filtra por serviço,
-- turno declarado e profissional (NULL = qualquer).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_proxima_oferta(p_agendamento_id INTEGER, p_minutos INTEGER DEFAULT 15)
RETURNS BIGINT LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE a RECORD; v_espera INTEGER; v_oferta BIGINT; v_periodo TEXT;
BEGIN
  SELECT ag.id, ag.clinica_id, ag.servico_id, ag.profissional_id, ag.inicio, c.timezone
    INTO a
    FROM agendamentos_sofia_demo ag JOIN clinicas c ON c.id = ag.clinica_id
   WHERE ag.id = p_agendamento_id;
  IF NOT FOUND OR a.servico_id IS NULL OR a.inicio IS NULL THEN RETURN NULL; END IF;

  -- já existe oferta pendente para esta vaga? a cascata é um por vez.
  IF EXISTS (SELECT 1 FROM ofertas_vaga WHERE agendamento_id = p_agendamento_id AND resposta IS NULL) THEN
    RETURN NULL;
  END IF;

  v_periodo := CASE WHEN (a.inicio AT TIME ZONE a.timezone)::time < '12:00' THEN 'manha' ELSE 'tarde' END;

  SELECT le.id INTO v_espera
    FROM lista_espera le
   WHERE le.clinica_id = a.clinica_id
     AND le.ativo
     AND (le.expira_em IS NULL OR le.expira_em >= CURRENT_DATE)
     AND le.servico_id = a.servico_id
     AND (le.profissional_id IS NULL OR le.profissional_id = a.profissional_id)
     AND (le.disponibilidade = 'qualquer' OR le.disponibilidade = v_periodo)
     -- não reoferece a quem já recebeu esta vaga
     AND NOT EXISTS (SELECT 1 FROM ofertas_vaga o
                      WHERE o.agendamento_id = p_agendamento_id AND o.lista_espera_id = le.id)
   ORDER BY le.criado_em ASC   -- ordem de chegada, §12.1
   LIMIT 1;

  IF v_espera IS NULL THEN RETURN NULL; END IF;  -- FILA_ESGOTADA

  INSERT INTO ofertas_vaga (clinica_id, agendamento_id, lista_espera_id, expira_em)
  VALUES (a.clinica_id, p_agendamento_id, v_espera, NOW() + (p_minutos || ' min')::interval)
  RETURNING id INTO v_oferta;

  RETURN v_oferta;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- fn_liberar_vaga — entrada da fila reversa. Respeita politica_vaga: onde a
-- clínica não ligou o automático, devolve NULL e a recepção é quem age.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_liberar_vaga(p_agendamento_id INTEGER)
RETURNS BIGINT LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE v_politica TEXT;
BEGIN
  SELECT c.politica_vaga INTO v_politica
    FROM agendamentos_sofia_demo ag JOIN clinicas c ON c.id = ag.clinica_id
   WHERE ag.id = p_agendamento_id;

  IF v_politica IS DISTINCT FROM 'automatica' THEN RETURN NULL; END IF;
  RETURN fn_proxima_oferta(p_agendamento_id);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- fn_expirar_ofertas — worker. Marca timeout e já puxa o próximo da fila.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_expirar_ofertas()
RETURNS INTEGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE r RECORD; n INTEGER := 0;
BEGIN
  FOR r IN SELECT id, agendamento_id FROM ofertas_vaga
            WHERE resposta IS NULL AND expira_em < NOW()
  LOOP
    UPDATE ofertas_vaga SET resposta = 'timeout', respondida_em = NOW() WHERE id = r.id;
    PERFORM fn_proxima_oferta(r.agendamento_id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- fn_payload_oferta — MESMO contrato de 4 chaves de fn_payload_lembrete (v1 §4.3).
-- O destinatário aqui é OUTRO paciente, o que torna o vazamento pior: mandar o
-- procedimento da vaga liberada contaria a um terceiro o que o primeiro ia fazer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_payload_oferta(p_oferta_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $fn$
DECLARE r JSONB;
BEGIN
  SELECT jsonb_build_object(
           'nome',         p.nome_completo,
           'data_hora',    to_char(ag.inicio AT TIME ZONE c.timezone, 'DD/MM/YYYY HH24:MI'),
           'unidade',      c.nome,
           'profissional', COALESCE(pr.nome, ag.profissional_legado)
         )
    INTO r
    FROM ofertas_vaga o
    JOIN agendamentos_sofia_demo ag ON ag.id = o.agendamento_id
    JOIN lista_espera le ON le.id = o.lista_espera_id
    JOIN pacientes p ON p.id = le.paciente_id     -- o CANDIDATO, não o que recusou
    JOIN clinicas c ON c.id = o.clinica_id
    LEFT JOIN profissionais pr ON pr.id = ag.profissional_id
   WHERE o.id = p_oferta_id;
  RETURN r;
END;
$fn$;

GRANT SELECT, INSERT, UPDATE ON lista_espera, ofertas_vaga TO app_painel;
GRANT SELECT, INSERT, UPDATE ON ofertas_vaga TO app_n8n;
GRANT SELECT ON lista_espera TO app_n8n;
GRANT USAGE, SELECT ON SEQUENCE lista_espera_id_seq, ofertas_vaga_id_seq TO app_painel, app_n8n;
GRANT EXECUTE ON FUNCTION fn_proxima_oferta(INTEGER, INTEGER), fn_liberar_vaga(INTEGER),
                          fn_expirar_ofertas(), fn_payload_oferta(BIGINT) TO app_painel, app_n8n;

COMMIT;
