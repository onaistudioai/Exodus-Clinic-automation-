-- 002-contract-test.sql — prova o freio de identidade (001-freio-identidade.sql).
--
-- Formato: BEGIN ... DO $$ ... RAISE EXCEPTION ... ROLLBACK, mesmo padrão dos
-- demais contract-tests do repo (auto-verificável, sem lixo no banco).
BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- (1) app_painel não acessa identidade_tentativas direto — só pela função.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_ok boolean;
BEGIN
  SELECT bool_and(NOT has_table_privilege('app_painel', 'identidade_tentativas', priv))
    INTO v_ok
    FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS priv;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'FALHA(1): app_painel tem acesso direto a identidade_tentativas.';
  END IF;
  RAISE NOTICE 'OK(1): identidade_tentativas fechada para app_painel — só via função.';
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- (2) app_painel TEM EXECUTE nas duas funções do freio.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT has_function_privilege('app_painel',
       'fn_identidade_freio(text, boolean)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'FALHA(2): app_painel sem EXECUTE em fn_identidade_freio.';
  END IF;
  IF NOT has_function_privilege('app_painel',
       'fn_identidade_freio_consultar(text)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'FALHA(2): app_painel sem EXECUTE em fn_identidade_freio_consultar.';
  END IF;
  RAISE NOTICE 'OK(2): app_painel executa as duas funções do freio.';
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- (3) 3 falhas seguidas bloqueiam; a 4ª continua bloqueada.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_tel text := '+5511900000000-teste-freio';
  v_espera int;
BEGIN
  DELETE FROM identidade_tentativas WHERE telefone = v_tel;

  PERFORM fn_identidade_freio(v_tel, false);
  PERFORM fn_identidade_freio(v_tel, false);
  v_espera := fn_identidade_freio(v_tel, false);
  IF v_espera <= 0 THEN
    RAISE EXCEPTION 'FALHA(3): 3ª falha deveria bloquear, devolveu %.', v_espera;
  END IF;

  v_espera := fn_identidade_freio(v_tel, false);
  IF v_espera <= 0 THEN
    RAISE EXCEPTION 'FALHA(3): 4ª tentativa deveria continuar bloqueada, devolveu %.', v_espera;
  END IF;

  v_espera := fn_identidade_freio_consultar(v_tel);
  IF v_espera <= 0 THEN
    RAISE EXCEPTION 'FALHA(3): consulta somente-leitura deveria refletir o bloqueio, devolveu %.', v_espera;
  END IF;

  RAISE NOTICE 'OK(3): 3 falhas bloqueiam, e o bloqueio persiste (registro e consulta).';
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- (4) Sucesso zera o histórico e libera.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_tel text := '+5511900000001-teste-freio';
  v_espera int;
BEGIN
  DELETE FROM identidade_tentativas WHERE telefone = v_tel;

  PERFORM fn_identidade_freio(v_tel, false);
  PERFORM fn_identidade_freio(v_tel, false);
  PERFORM fn_identidade_freio(v_tel, false);

  v_espera := fn_identidade_freio(v_tel, true);
  IF v_espera <> 0 THEN
    RAISE EXCEPTION 'FALHA(4): sucesso deveria devolver 0, devolveu %.', v_espera;
  END IF;

  IF EXISTS (SELECT 1 FROM identidade_tentativas WHERE telefone = v_tel AND NOT sucesso) THEN
    RAISE EXCEPTION 'FALHA(4): sucesso deveria zerar o histórico de falhas.';
  END IF;

  v_espera := fn_identidade_freio_consultar(v_tel);
  IF v_espera <> 0 THEN
    RAISE EXCEPTION 'FALHA(4): telefone liberado deveria consultar 0, devolveu %.', v_espera;
  END IF;

  RAISE NOTICE 'OK(4): sucesso zera o histórico e libera imediatamente.';
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- (5) Telefones diferentes não interferem entre si (mesma chave = telefone).
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_a text := '+5511900000002-teste-freio';
  v_b text := '+5511900000003-teste-freio';
  v_espera int;
BEGIN
  DELETE FROM identidade_tentativas WHERE telefone IN (v_a, v_b);

  PERFORM fn_identidade_freio(v_a, false);
  PERFORM fn_identidade_freio(v_a, false);
  PERFORM fn_identidade_freio(v_a, false);

  v_espera := fn_identidade_freio_consultar(v_b);
  IF v_espera <> 0 THEN
    RAISE EXCEPTION 'FALHA(5): telefone % bloqueado por tentativas de outro número.', v_b;
  END IF;

  RAISE NOTICE 'OK(5): o freio é por telefone — números diferentes não se contaminam.';
END $$;

ROLLBACK;
