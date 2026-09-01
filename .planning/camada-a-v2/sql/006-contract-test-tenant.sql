-- ============================================================================
-- 006-contract-test-tenant.sql — prova que job sem tenant FALHA em vez de mentir.
-- BEGIN ... ROLLBACK. Pré-requisito: 005-tenant-de-job.sql.
-- ============================================================================
BEGIN;

DO $$
DECLARE v_n int; v_erro text; v_linhas int;
BEGIN
  -- (1) fn_tenant_atual devolve o tenant quando ele existe
  PERFORM set_config('app.clinica_id','1',true);
  IF fn_tenant_atual() <> 1 THEN
    RAISE EXCEPTION 'FALHA(1): fn_tenant_atual nao devolveu o GUC';
  END IF;

  -- (2) e FALHA ALTO quando não existe — este é o ponto do arquivo inteiro
  PERFORM set_config('app.clinica_id','',true);
  BEGIN
    PERFORM fn_tenant_atual();
    RAISE EXCEPTION 'FALHA(2): fn_tenant_atual devolveu valor sem GUC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;  -- esperado
  END;

  -- (3) o job por tenant não roda mudo: sem GUC, levanta
  BEGIN
    PERFORM fn_expirar_ofertas();
    RAISE EXCEPTION 'FALHA(3) SILENCIO: fn_expirar_ofertas rodou sem tenant';
  EXCEPTION WHEN insufficient_privilege THEN NULL;  -- esperado
  END;

  -- (4) com tenant, roda normalmente
  PERFORM set_config('app.clinica_id','1',true);
  v_n := fn_expirar_ofertas();
  IF v_n IS NULL THEN
    RAISE EXCEPTION 'FALHA(4): job com tenant deveria rodar';
  END IF;

  -- (5) a varredura declarada cobre TODAS as clínicas, uma por vez
  PERFORM set_config('app.clinica_id','',true);
  SELECT count(*) INTO v_linhas FROM fn_por_clinica('fn_expirar_ofertas');
  IF v_linhas <> (SELECT count(*) FROM clinicas) THEN
    RAISE EXCEPTION 'FALHA(5): varredura cobriu % de % clinicas', v_linhas, (SELECT count(*) FROM clinicas);
  END IF;

  -- (6) injeção no nome da função é recusada (a varredura é SECURITY DEFINER)
  BEGIN
    PERFORM fn_por_clinica('fn_expirar_ofertas(); DROP TABLE clinicas; --');
    RAISE EXCEPTION 'FALHA(6) INJECAO: nome de funcao arbitrario foi aceito';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHA(%' THEN RAISE; END IF;  -- a recusa é o esperado
  END;

  -- (7) função inexistente também é recusada
  BEGIN
    PERFORM fn_por_clinica('fn_que_nao_existe');
    RAISE EXCEPTION 'FALHA(7): funcao inexistente foi aceita';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHA(%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'OK: wrapper de tenant — 7 garantias provadas.';
END $$;

ROLLBACK;
