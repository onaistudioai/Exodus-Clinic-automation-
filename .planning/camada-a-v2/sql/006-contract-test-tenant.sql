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

  -- (5) a varredura declarada cobre as clínicas ATIVAS, uma por vez — não mais
  -- "todas": acesso-009-neutraliza-teste-e-fn-por-clinica.sql corrigiu um bug
  -- latente (fn_por_clinica não filtrava `ativa`, então job por tenant varria
  -- clínica desativada). Achado ao aplicar a correção, não intencional desde
  -- o início — este arquivo tinha a asserção antiga (v_linhas = count(*) sem
  -- filtro), que agora seria falso positivo do bug, não prova de correção.
  PERFORM set_config('app.clinica_id','',true);
  SELECT count(*) INTO v_linhas FROM fn_por_clinica('fn_expirar_ofertas');
  IF v_linhas <> (SELECT count(*) FROM clinicas WHERE ativa) THEN
    RAISE EXCEPTION 'FALHA(5): varredura cobriu % de % clinicas ativas', v_linhas, (SELECT count(*) FROM clinicas WHERE ativa);
  END IF;

  -- (5b) prova direta: uma clínica INATIVA, criada e revertida só dentro desta
  -- transação (ROLLBACK no fim do arquivo cuida da limpeza), não aparece entre
  -- os ids varridos.
  DECLARE
    v_clinica_inativa_id INTEGER;
    v_apareceu BOOLEAN;
  BEGIN
    INSERT INTO clinicas (nome, ativa) VALUES ('[CONTRACT-TEST] inativa', false)
      RETURNING id INTO v_clinica_inativa_id;
    SELECT EXISTS (
      SELECT 1 FROM fn_por_clinica('fn_expirar_ofertas') WHERE clinica_id = v_clinica_inativa_id
    ) INTO v_apareceu;
    IF v_apareceu THEN
      RAISE EXCEPTION 'FALHA(5b): clinica inativa (id %) foi varrida por fn_por_clinica', v_clinica_inativa_id;
    END IF;
  END;

  -- (6) injeção no nome da função é recusada (a varredura é SECURITY DEFINER)
  BEGIN
    PERFORM fn_por_clinica('fn_expirar_ofertas(); DROP TABLE clinicas; --');
    RAISE EXCEPTION 'FALHA(6) INJECAO: nome de funcao arbitrario foi aceito';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHA(%' THEN RAISE; END IF;  -- a recusa é o esperado
  END;

  -- (7) função inexistente também é recusada.
  --
  -- SQLSTATE mudou em 2026-09-01 (camada-a-v2/008-inventario-alcance.sql): o
  -- gate deixou de ser "existe em pg_proc?" (RAISE EXCEPTION genérico) e virou
  -- "está no inventário funcao_alcance?" (ERRCODE insufficient_privilege,
  -- deliberado — é rejeição de autorização, não de sintaxe, e a mesma classe
  -- que 009-contract-test-fonte-unica.sql já prova para 'pg_sleep'). Achado
  -- rodando este arquivo pela primeira vez via test-db.mjs — antes de hoje ele
  -- não estava no CI e o desalinhamento não aparecia.
  BEGIN
    PERFORM fn_por_clinica('fn_que_nao_existe');
    RAISE EXCEPTION 'FALHA(7): funcao inexistente foi aceita';
  EXCEPTION WHEN insufficient_privilege THEN NULL;  -- esperado
  END;

  RAISE NOTICE 'OK: wrapper de tenant — 7 garantias provadas.';
END $$;

ROLLBACK;
