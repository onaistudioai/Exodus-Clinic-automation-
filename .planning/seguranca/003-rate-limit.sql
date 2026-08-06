-- 003-rate-limit.sql — S5: freio de força bruta no login.
--
-- Por que no banco e não em memória: o painel roda serverless (Vercel), então
-- contador em processo não sobrevive entre invocações nem entre instâncias.
-- Volume de uma clínica não justifica Redis.
--
-- A tabela é PRÉ-autenticação: não tem clinica_id (ainda não se sabe o tenant),
-- e por isso não entra na RLS de tenant. Ela não guarda dado de paciente —
-- só e-mail tentado, IP e horário. Acesso via função SECURITY DEFINER, no mesmo
-- padrão do fn_login_lookup.
BEGIN;

CREATE TABLE IF NOT EXISTS login_tentativas (
  id          bigserial PRIMARY KEY,
  email       text        NOT NULL,
  ip          text        NOT NULL,
  sucesso     boolean     NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_login_tentativas_janela
  ON login_tentativas (email, ip, criado_em DESC);

REVOKE ALL ON login_tentativas FROM PUBLIC;
REVOKE ALL ON login_tentativas FROM app_painel;

/**
 * Registra a tentativa e devolve quantos segundos faltam de bloqueio (0 = liberado).
 *
 * Regra: 5 falhas em 15 min bloqueiam. O bloqueio é progressivo — dobra a cada
 * 5 falhas (5->1min, 10->2min, 15->4min...), teto de 30 min. Progressivo em vez
 * de fixo porque trava o ataque automatizado sem punir o recepcionista que
 * errou a senha três vezes de manhã.
 *
 * Chave = (email, ip). Só e-mail permitiria a um atacante trancar a conta de um
 * funcionário de fora (DoS); só IP deixaria passar spray distribuído.
 */
CREATE OR REPLACE FUNCTION fn_login_freio(p_email text, p_ip text, p_sucesso boolean)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_falhas int;
  v_ultima timestamptz;
  v_espera int;
BEGIN
  -- Sucesso zera o histórico: sessão legítima não deve arrastar bloqueio.
  IF p_sucesso THEN
    DELETE FROM login_tentativas WHERE email = p_email AND ip = p_ip;
    INSERT INTO login_tentativas (email, ip, sucesso) VALUES (p_email, p_ip, true);
    RETURN 0;
  END IF;

  INSERT INTO login_tentativas (email, ip, sucesso) VALUES (p_email, p_ip, false);

  SELECT count(*), max(criado_em) INTO v_falhas, v_ultima
    FROM login_tentativas
   WHERE email = p_email AND ip = p_ip
     AND NOT sucesso
     AND criado_em > now() - interval '15 minutes';

  IF v_falhas < 5 THEN RETURN 0; END IF;

  -- 5->60s, 10->120s, 15->240s ... teto 1800s
  v_espera := least(60 * power(2, (v_falhas / 5) - 1)::int, 1800);
  RETURN greatest(0, v_espera - EXTRACT(EPOCH FROM (now() - v_ultima))::int);
END $$;

REVOKE ALL ON FUNCTION fn_login_freio(text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_login_freio(text, text, boolean) TO app_painel;

-- Higiene: a tabela não precisa de histórico longo (e guardar e-mail+IP por
-- tempo indefinido é minimização de dados mal feita, art. 6º III LGPD).
CREATE OR REPLACE FUNCTION fn_login_tentativas_purgar() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM login_tentativas WHERE criado_em < now() - interval '30 days';
$$;

COMMIT;
