-- 005-nivel-autorizacao.sql — liga paciente_contato.papel/.nivel, que existem
-- desde bot-agendamento/001-bot-agendamento.sql e nenhum código de app lia.
--
-- O MODELO, em uma frase: o telefone resolve QUEM FALA (Fase 2, inalterado);
-- o nível do vínculo decide EM NOME DE QUEM e ATÉ ONDE.
BEGIN;

-- ---------------------------------------------------------------------------
-- RISCO DE APAGÃO — leia antes de rodar em produção.
--
-- `nivel` tem DEFAULT 'nenhum', e todo vínculo TITULAR existente foi criado
-- antes destas colunas existirem. Ligar a checagem de nível (identidade.repo.ts)
-- sem este backfill tira TODO paciente do acesso ao próprio dado no dia do
-- deploy — pior que o bug que a Fase 2 corrigiu.
--
-- Titular do próprio registro recebe agendar_e_consultar: ver o próprio dado é
-- direito dele (LGPD art. 18), não uma concessão do balcão — é o que o sistema
-- já entrega hoje, sem esta trava. Idempotente: só toca quem ainda está no
-- default 'nenhum', não sobrescreve um nível que o balcão já tenha ajustado.
UPDATE paciente_contato
   SET nivel = 'agendar_e_consultar'
 WHERE papel = 'titular'
   AND nivel = 'nenhum';

-- Vínculo NÃO-titular (responsavel/autorizado) NÃO recebe nada no backfill.
-- Parece assimetria arbitrária — não é: titular tem direito ESTRUTURAL ao
-- próprio dado; um terceiro só ganha alcance por ATO HUMANO no balcão
-- (definirNivelAction, painel de pacientes), nunca por default de migração ou
-- por autoatendimento no WhatsApp. É a linha que impede "eu digito que sou a
-- mãe dela" de virar poder.

-- ---------------------------------------------------------------------------
-- Mesma regra daqui em diante: todo vínculo TITULAR novo nasce com o nível
-- estrutural, sem depender de alguém lembrar de conceder.
--
-- CUIDADO DE ORDEM (mesma armadilha de camada-a-v2/007-estados-fonte-unica.sql,
-- corrigida hoje mais cedo): já existe t_papel_do_titular, outro BEFORE INSERT
-- na mesma tabela, e triggers BEFORE do mesmo evento disparam em ordem
-- ALFABÉTICA pelo NOME — não pela ordem de criação. Em vez de nomear este
-- trigger para cair depois por acidente de alfabeto, ele deriva `papel` DE
-- NOVO por conta própria (mesma expressão de trg_papel_do_titular) e não
-- depende de rodar depois do outro. Duas leituras da mesma regra > uma
-- dependência de ordem invisível no nome.
CREATE OR REPLACE FUNCTION trg_nivel_titular_baseline() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_papel papel_vinculo;
BEGIN
  v_papel := COALESCE(NEW.papel, CASE WHEN NEW.titular THEN 'titular' ELSE 'autorizado' END::papel_vinculo);
  IF v_papel = 'titular' AND NEW.nivel = 'nenhum' THEN
    NEW.nivel := 'agendar_e_consultar';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS t_nivel_titular_baseline ON paciente_contato;
CREATE TRIGGER t_nivel_titular_baseline
  BEFORE INSERT ON paciente_contato
  FOR EACH ROW EXECUTE FUNCTION trg_nivel_titular_baseline();
COMMENT ON TRIGGER t_nivel_titular_baseline ON paciente_contato IS
  'Só INSERT, de propósito: uma vez criado o vínculo, o balcão ajusta nivel livremente (definirNivelAction) sem este trigger brigar de volta numa UPDATE administrativa.';

COMMIT;
