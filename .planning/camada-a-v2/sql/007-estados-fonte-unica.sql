-- ============================================================================
-- 007-estados-fonte-unica.sql — a lista de estados passa a existir UMA vez.
--
-- O PROBLEMA: a mesma verdade estava escrita em quatro lugares que não se
-- anunciavam como cópias — por isso divergiram sem ninguém notar:
--
--   bot-agendamento/001:62          CHECK com 8 estados
--   camada-a/002:28                 CHECK com 11 (redefine o mesmo constraint)
--   camada-a/002:48                 fn_transicao_valida, 11 num CASE
--   sofia-demo/schema-...-bella:13  6 estados, VOCABULÁRIO INCOMPATÍVEL
--
-- O CHECK e a função pareciam camadas complementares (uma valida o valor, a
-- outra o caminho). São cópias: as duas enumeram o conjunto. Daqui em diante o
-- conjunto vive em `estado_agendamento` e o resto DERIVA dele — a função por
-- lookup, o CHECK virou FK. Acrescentar estado é INSERT, não editar 4 arquivos.
--
-- Idempotente. Ordem interna importa: migrar dados ANTES da FK.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- (1) O conjunto. `terminal` não é rótulo: é o que gera as transições abaixo.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS estado_agendamento (
  estado   TEXT PRIMARY KEY,
  terminal BOOLEAN NOT NULL
);
COMMENT ON TABLE estado_agendamento IS
  'FONTE UNICA dos estados de agendamento. Nao replicar esta lista em CHECK, CASE ou TS sem derivar daqui.';

INSERT INTO estado_agendamento (estado, terminal) VALUES
  ('reservada',       false),
  ('agendada',        false),
  ('confirmada',      false),
  ('sem_resposta',    false),
  ('escalado_humano', false),
  ('cancelada',       true),
  ('remarcada',       true),
  ('realizada',       true),
  ('no_show',         true),
  ('expirada',        true),
  -- recusada é terminal PARA O AGENDAMENTO: a vaga segue em ofertas_vaga, não
  -- reaproveitando esta linha. E é distinta de cancelada — cancelada é ato da
  -- clínica, recusada é resposta do paciente, e só a segunda é métrica.
  ('recusada',        true)
ON CONFLICT (estado) DO UPDATE SET terminal = EXCLUDED.terminal;

-- ---------------------------------------------------------------------------
-- (2) As transições. Tabela, não CASE.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transicao_agendamento (
  de   TEXT NOT NULL REFERENCES estado_agendamento(estado),
  para TEXT NOT NULL REFERENCES estado_agendamento(estado),
  PRIMARY KEY (de, para)
);

INSERT INTO transicao_agendamento (de, para) VALUES
  ('reservada','confirmada'), ('reservada','cancelada'),
  ('reservada','expirada'),   ('reservada','recusada'),
  ('agendada','confirmada'),  ('agendada','cancelada'),
  ('agendada','remarcada'),   ('agendada','recusada'),
  ('agendada','sem_resposta'),
  ('confirmada','realizada'), ('confirmada','no_show'),
  ('confirmada','cancelada'), ('confirmada','remarcada'),
  -- silêncio não é fim: o paciente pode responder depois do H-1.
  ('sem_resposta','confirmada'), ('sem_resposta','cancelada'),
  ('sem_resposta','remarcada'),  ('sem_resposta','no_show'),
  ('sem_resposta','recusada'),
  -- volta da fila humana: alguém resolveu e o fluxo continua.
  ('escalado_humano','confirmada'), ('escalado_humano','cancelada'),
  ('escalado_humano','remarcada'),  ('escalado_humano','recusada'),
  ('escalado_humano','agendada')
ON CONFLICT DO NOTHING;

-- Escalar é permitido a partir de QUALQUER estado vivo: o bot desistir nunca
-- pode ser bloqueado por regra de fluxo. Antes isto era um ramo especial no
-- CASE, que a guarda do trigger copiava à mão (e copiou errado). Agora é
-- DERIVADO de `terminal` — a regra e a guarda não têm como divergir.
INSERT INTO transicao_agendamento (de, para)
  SELECT estado, 'escalado_humano' FROM estado_agendamento
  WHERE NOT terminal AND estado <> 'escalado_humano'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- (2b) A FONTE DA VERDADE É SOMENTE LEITURA PARA A APLICAÇÃO.
--
-- Sem isto, as duas tabelas nascem com `arw` para app_painel — o schema tem
-- ALTER DEFAULT PRIVILEGES concedendo INSERT/UPDATE a toda tabela nova. Medido:
-- app_painel conseguiu inserir ('realizada','agendada') e reescrever a máquina
-- de estados EM RUNTIME. Tirar a regra do CASE e colocá-la numa tabela só é um
-- ganho se a tabela não for gravável por quem obedece a ela.
-- ---------------------------------------------------------------------------
REVOKE ALL ON estado_agendamento, transicao_agendamento FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON estado_agendamento, transicao_agendamento
  FROM app_painel, app_n8n;
-- SELECT é obrigatório: fn_transicao_valida é SECURITY INVOKER e o trigger de
-- estado roda como o chamador. Sem SELECT, todo UPDATE de status falha 42501.
GRANT SELECT ON estado_agendamento, transicao_agendamento TO app_painel, app_n8n;

-- ---------------------------------------------------------------------------
-- (3) MIGRAÇÃO DO VOCABULÁRIO LEGADO (schema-agendamentos-bella).
--     'pendente' e 'remarcacao_pendente' nunca existiram na máquina. Precisa
--     rodar ANTES da FK, senão a FK rejeita as linhas vivas.
--     Os triggers são desligados na transação: estas transições são de
--     RENOMEAÇÃO, não de fluxo — não devem ser validadas como caminho.
-- ---------------------------------------------------------------------------
ALTER TABLE agendamentos_sofia_demo DISABLE TRIGGER USER;
UPDATE agendamentos_sofia_demo SET status = 'agendada'  WHERE status = 'pendente';
UPDATE agendamentos_sofia_demo SET status = 'remarcada' WHERE status = 'remarcacao_pendente';
ALTER TABLE agendamentos_sofia_demo ENABLE TRIGGER USER;

-- o DEFAULT do schema legado também apontava para um estado inexistente.
ALTER TABLE agendamentos_sofia_demo ALTER COLUMN status SET DEFAULT 'agendada';

-- ---------------------------------------------------------------------------
-- (4) O CHECK morre. A FK é a mesma garantia sem a segunda cópia da lista.
-- ---------------------------------------------------------------------------
ALTER TABLE agendamentos_sofia_demo DROP CONSTRAINT IF EXISTS chk_status_agendamento;
ALTER TABLE agendamentos_sofia_demo DROP CONSTRAINT IF EXISTS agendamentos_sofia_demo_status_check;
ALTER TABLE agendamentos_sofia_demo DROP CONSTRAINT IF EXISTS fk_status_agendamento;
ALTER TABLE agendamentos_sofia_demo ADD CONSTRAINT fk_status_agendamento
  FOREIGN KEY (status) REFERENCES estado_agendamento(estado);

-- ---------------------------------------------------------------------------
-- (5) A função vira lookup.
--     STABLE, não IMMUTABLE: ela lê tabela agora. Manter IMMUTABLE seria mentir
--     para o planner, que pode dobrar a chamada em constante.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_transicao_valida(p_de TEXT, p_para TEXT)
RETURNS BOOLEAN STABLE LANGUAGE sql AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM transicao_agendamento WHERE de = p_de AND para = p_para
  );
$fn$;

-- ---------------------------------------------------------------------------
-- (6) A guarda da escalada PERGUNTA à máquina em vez de repetir a lista.
--
--     BUG ATIVO QUE ISTO CORRIGE: a guarda antiga era
--       NEW.status NOT IN ('escalado_humano','cancelada','realizada','no_show','expirada')
--     que omite 'remarcada'. A máquina trata 'remarcada' como terminal. Um
--     UPDATE tocando status E falhas_classificacao no mesmo SET escalava um
--     agendamento remarcado e a máquina levantava exceção logo depois.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_escala_por_falhas() RETURNS TRIGGER
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.falhas_classificacao >= 2
     AND NEW.status <> 'escalado_humano'
     AND fn_transicao_valida(NEW.status, 'escalado_humano') THEN
    NEW.status := 'escalado_humano';
  END IF;
  RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- (7) ORDEM DOS TRIGGERS, EXPLÍCITA.
--
--     O Postgres dispara BEFORE triggers em ordem ALFABÉTICA do nome. A ordem
--     correta aqui não é preferência: a escalada GRAVA NEW.status, e a máquina
--     precisa validar o valor JÁ ESCALADO. Invertido, a escalada automática
--     passa sem validação nenhuma.
--
--     Os nomes antigos (t_escala_por_falhas < t_estado_agendamento) acertavam
--     por acaso da grafia. O prefixo numérico torna a razão legível ANTES de
--     alguém escolher onde encaixar um terceiro passo.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS t_escala_por_falhas    ON agendamentos_sofia_demo;
DROP TRIGGER IF EXISTS t_estado_agendamento   ON agendamentos_sofia_demo;
DROP TRIGGER IF EXISTS t_1_escala_por_falhas  ON agendamentos_sofia_demo;
DROP TRIGGER IF EXISTS t_2_estado_agendamento ON agendamentos_sofia_demo;

CREATE TRIGGER t_1_escala_por_falhas
  BEFORE UPDATE OF falhas_classificacao ON agendamentos_sofia_demo
  FOR EACH ROW EXECUTE FUNCTION trg_escala_por_falhas();

CREATE TRIGGER t_2_estado_agendamento
  BEFORE UPDATE OF status ON agendamentos_sofia_demo
  FOR EACH ROW EXECUTE FUNCTION trg_estado_agendamento();

-- No banco, onde o comentário do arquivo não chega:
COMMENT ON TRIGGER t_1_escala_por_falhas ON agendamentos_sofia_demo IS
  'PASSO 1 de 2. Grava NEW.status. DEVE rodar antes de t_2_estado_agendamento (ordem = alfabetica do nome). Terceiro passo? o prefixo declara a posicao.';
COMMENT ON TRIGGER t_2_estado_agendamento ON agendamentos_sofia_demo IS
  'PASSO 2 de 2. Valida o status ja possivelmente reescrito pelo passo 1. Renomear para antes de t_1_ reintroduz escalada sem validacao.';

COMMIT;
