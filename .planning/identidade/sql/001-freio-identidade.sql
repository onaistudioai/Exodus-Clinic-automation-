-- 001-freio-identidade.sql — freio de força bruta na confirmação de identidade
-- do paciente por WhatsApp (src/server/identidade.repo.ts, confirmarIdentidade).
--
-- MESMO MECANISMO de seguranca/003-rate-limit.sql (fn_login_freio): tabela
-- PRÉ-autenticação + função SECURITY DEFINER. Não é um segundo dialeto de
-- freio — é reconhecidamente o mesmo, com o limiar ajustado ao que se está
-- protegendo.
BEGIN;

-- SEM clinica_id, de propósito (não é esquecimento):
--   (a) mesmo precedente de login_tentativas — tabela PRÉ-autenticação não
--       entra na RLS de tenant;
--   (b) clinica_id faria o sweep de 001-lockdown.sql aplicar RLS FORCE aqui,
--       e como o acesso é por SECURITY DEFINER cujo dono tem rolbypassrls=true
--       (achado de camada-a-v2/005-tenant-de-job.sql), a RLS seria contornada
--       em silêncio — garantia aparente que não existe;
--   (c) quem ataca é a mesma pessoa física independente de quantas clínicas o
--       número frequenta — contar junto é mais correto, não menos.
--
-- Telefone em claro está certo aqui: já está em claro em contatos_whatsapp,
-- tabela ao lado — hashear nesta não protegeria nada e custaria um pepper de
-- ambiente a mais. Não reabrir essa discussão sem um motivo novo.
CREATE TABLE IF NOT EXISTS identidade_tentativas (
  id          bigserial   PRIMARY KEY,
  telefone    text        NOT NULL,
  sucesso     boolean     NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_identidade_tentativas_janela
  ON identidade_tentativas (telefone, criado_em DESC);

REVOKE ALL ON identidade_tentativas FROM PUBLIC;
REVOKE ALL ON identidade_tentativas FROM app_painel;

/**
 * Cálculo puro do bloqueio — janela, limiar e progressão moram SÓ AQUI.
 * fn_identidade_freio_consultar() e fn_identidade_freio() chamam esta; nenhuma
 * das duas repete a regra. Ver ACHADO abaixo: era duplicada verbatim nas duas
 * até a sessão par apontar (2026-09-01) — mesma classe de risco de "duas
 * fontes que podem divergir sem que ninguém tenha editado nenhuma delas de
 * propósito" documentada em seguranca/schema-modulos.mjs, só que aqui as duas
 * cópias eram da MESMA mão no MESMO arquivo — mais fácil de notar, e ainda
 * assim passou.
 *
 * NÃO é SECURITY DEFINER: só lê o que o caller já tem direito de ler (é
 * chamada de dentro de outra função DEFINER), não precisa nem deve ampliar
 * privilégio por conta própria.
 *
 * LIMIAR MAIS APERTADO que o do login (3 falhas em 15min contra 5): senha tem
 * entropia alta, data de nascimento não — um atacante que conhece a pessoa
 * chuta o ano certo de primeira e varre no máximo 365 possibilidades, muitas
 * vezes bem menos. O 3 não é arbitrário: casa com o "encerrar após 3
 * tentativas" que src/server/identidade.repo.ts já pedia num comentário
 * ponytail antes deste arquivo existir.
 */
CREATE OR REPLACE FUNCTION fn_identidade_freio_calcular(p_telefone text)
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_falhas int;
  v_ultima timestamptz;
BEGIN
  SELECT count(*), max(criado_em) INTO v_falhas, v_ultima
    FROM identidade_tentativas
   WHERE telefone = p_telefone
     AND NOT sucesso
     AND criado_em > now() - interval '15 minutes';

  IF v_falhas < 3 THEN RETURN 0; END IF;

  -- 3->60s, 6->120s, 9->240s ... teto 1800s. Mesma progressão de fn_login_freio,
  -- limiar de falhas mais apertado.
  RETURN greatest(0,
    least(60 * power(2, (v_falhas / 3) - 1)::int, 1800)
      - EXTRACT(EPOCH FROM (now() - v_ultima))::int);
END $$;

-- Uso só interno (chamada de dentro de fn_identidade_freio* enquanto elas
-- executam como DEFINER/dono). Sem GRANT: nenhum role de aplicação precisa
-- chamar isto direto, e mesmo que tentasse, SECURITY INVOKER + REVOKE ALL na
-- tabela abaixo já barra na consulta.
REVOKE ALL ON FUNCTION fn_identidade_freio_calcular(text) FROM PUBLIC;

/**
 * Só CONSULTA — não registra. Usada no gate de identificarPaciente() antes de
 * chamar confirmarIdentidade(), para o paciente que ainda não digitou a data
 * de nascimento não gastar orçamento de tentativa só por ter mandado telefone.
 *
 * Separada de fn_identidade_freio() em vez de um terceiro estado no parâmetro
 * p_sucesso: um booleano com um valor "não registre isto" é uma interface que
 * mente sobre o que a chamada faz. Duas funções pequenas > uma função com
 * comportamento condicional pelo valor do argumento.
 */
CREATE OR REPLACE FUNCTION fn_identidade_freio_consultar(p_telefone text)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fn_identidade_freio_calcular(p_telefone);
$$;

REVOKE ALL ON FUNCTION fn_identidade_freio_consultar(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_identidade_freio_consultar(text) TO app_painel;

/**
 * Registra a tentativa (uma data de nascimento foi de fato enviada) e devolve
 * segundos restantes de bloqueio (0 = liberado).
 */
CREATE OR REPLACE FUNCTION fn_identidade_freio(p_telefone text, p_sucesso boolean)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_sucesso THEN
    DELETE FROM identidade_tentativas WHERE telefone = p_telefone;
    INSERT INTO identidade_tentativas (telefone, sucesso) VALUES (p_telefone, true);
    RETURN 0;
  END IF;

  INSERT INTO identidade_tentativas (telefone, sucesso) VALUES (p_telefone, false);
  RETURN fn_identidade_freio_calcular(p_telefone);
END $$;

REVOKE ALL ON FUNCTION fn_identidade_freio(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_identidade_freio(text, boolean) TO app_painel;

-- Higiene/LGPD: mesmo prazo de fn_login_tentativas_purgar.
CREATE OR REPLACE FUNCTION fn_identidade_tentativas_purgar() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM identidade_tentativas WHERE criado_em < now() - interval '30 days';
$$;

COMMIT;
