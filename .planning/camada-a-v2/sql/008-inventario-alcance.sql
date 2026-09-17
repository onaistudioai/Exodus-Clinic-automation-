-- ============================================================================
-- 008-inventario-alcance.sql — o alcance de cada função definer, declarado.
--
-- MESMO CONSERTO DO 007, aplicado ao alcance em vez do estado.
--
-- fn_por_clinica validava que a função EXISTE (pg_proc, sem filtro de schema),
-- não que ela PODE ser chamada. Qualquer função sem argumentos, em qualquer
-- schema, rodava com direitos do dono — que tem rolbypassrls neste banco
-- (medido em 005-tenant-de-job.sql:4-12). Bloqueava injeção de string, não
-- bloqueava escolha de alvo.
--
-- Mas uma allowlist só fecha quem fn_por_clinica aceita chamar. NÃO fecha o
-- caso geral: função definer nova, declarada `tenant`, continua rodando
-- cross-tenant se for chamada por qualquer outro caminho — cron direto, psql
-- ad-hoc, workflow do n8n. Por isso o inventário é TABELA consultada em
-- runtime, não arquivo comparado no CI: a allowlist deixa de ser cópia da
-- verdade e passa a SER a verdade.
--
-- As duas regras que o contract-test impõe sobre esta tabela:
--   1. função SECURITY DEFINER fora do inventário            -> CI falha
--   2. função declarada `tenant` que É definer de dono com
--      BYPASSRLS -> declaração não corresponde ao comportamento -> CI falha
--
-- A regra 2 é a que pega fn_expurgo_mensagens sem depender de alguém ter
-- lembrado de listá-la.
--
-- Idempotente.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS funcao_alcance (
  funcao  TEXT PRIMARY KEY,
  alcance TEXT NOT NULL CHECK (alcance IN ('tenant','cross_tenant')),
  motivo  TEXT NOT NULL
);
COMMENT ON TABLE funcao_alcance IS
  'FONTE UNICA do alcance das funcoes de job. fn_por_clinica consulta em runtime. Declarar cross_tenant e uma decisao, nao um default.';

INSERT INTO funcao_alcance (funcao, alcance, motivo) VALUES
  ('fn_expirar_ofertas',   'tenant',
   'Libera vaga de oferta vencida. SECURITY INVOKER + fn_tenant_atual().'),
  ('fn_expurgo_mensagens', 'tenant',
   'Pseudonimiza mensagens por prazo. Era DEFINER e varria todas as clinicas de uma vez (medido 2026-09-01).'),
  ('fn_expurgo_leads',     'tenant',
   'Mesmo molde do expurgo de mensagens.'),
  -- cross_tenant HONESTO, nao um definer disfarcado: ela ja itera clinicas por
  -- dentro DE PROPOSITO, e a primeira etapa (login_tentativas) nao tem tenant.
  -- E uma varredura declarada, como fn_por_clinica.
  ('fn_expurgo_retencao',  'cross_tenant',
   'Expurgo do ROPA. Varre todas as clinicas por design e purga login_tentativas, que nao tem clinica_id.'),
  ('fn_login_lookup',      'cross_tenant',
   'DELIBERADO: roda ANTES de haver tenant. E o que descobre a clinica do usuario.'),
  ('fn_login_freio',       'cross_tenant',
   'DELIBERADO: login_tentativas nao tem clinica_id por design (freio e por IP/usuario).'),
  ('fn_login_tentativas_purgar', 'cross_tenant',
   'DELIBERADO: purga a mesma tabela sem tenant de fn_login_freio.'),
  ('fn_por_clinica',       'cross_tenant',
   'E A PROPRIA varredura. Precisa enxergar a lista de clinicas.'),
  -- .planning/identidade/sql/001-freio-identidade.sql (2026-09-01): mesmo
  -- molde do freio de login. identidade_tentativas tambem nao tem clinica_id
  -- por design (quem ataca e a mesma pessoa fisica em qualquer clinica).
  ('fn_identidade_freio',            'cross_tenant',
   'DELIBERADO: identidade_tentativas nao tem clinica_id por design (mesmo motivo de fn_login_freio).'),
  ('fn_identidade_freio_consultar',  'cross_tenant',
   'DELIBERADO: leitura da mesma tabela sem tenant de fn_identidade_freio.'),
  ('fn_identidade_tentativas_purgar','cross_tenant',
   'DELIBERADO: purga a mesma tabela sem tenant de fn_identidade_freio.')
ON CONFLICT (funcao) DO UPDATE
  SET alcance = EXCLUDED.alcance, motivo = EXCLUDED.motivo;

-- ---------------------------------------------------------------------------
-- fn_por_clinica passa a consultar o inventário.
-- Só chama o que está declarado `tenant`: chamar uma cross_tenant clínica a
-- clínica rodaria N vezes sobre tudo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_por_clinica(p_funcao TEXT)
RETURNS TABLE(clinica_id INTEGER, resultado INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE c RECORD; n INTEGER; v_alcance TEXT;
BEGIN
  -- só nome simples: sem isto, `p_funcao` seria injeção de SQL com direitos de dono.
  IF p_funcao !~ '^[a-z_][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'nome de funcao invalido: %', p_funcao;
  END IF;

  -- ANTES: `EXISTS (SELECT 1 FROM pg_proc WHERE proname = p_funcao)` — provava
  -- que a função existe, o que é verdade para pg_sleep e todo o catálogo.
  SELECT alcance INTO v_alcance FROM funcao_alcance WHERE funcao = p_funcao;
  IF v_alcance IS NULL THEN
    RAISE EXCEPTION 'funcao % nao esta no inventario de alcance (funcao_alcance)', p_funcao
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_alcance <> 'tenant' THEN
    RAISE EXCEPTION 'funcao % e % — varrer por clinica so faz sentido para alcance tenant', p_funcao, v_alcance
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = p_funcao) THEN
    RAISE EXCEPTION 'funcao % inventariada mas inexistente no banco', p_funcao;
  END IF;

  FOR c IN SELECT id FROM clinicas ORDER BY id LOOP
    PERFORM set_config('app.clinica_id', c.id::text, true);
    EXECUTE format('SELECT %I()', p_funcao) INTO n;
    clinica_id := c.id; resultado := COALESCE(n, 0);
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('app.clinica_id', '', true);
END;
$fn$;

REVOKE ALL ON FUNCTION fn_por_clinica(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_por_clinica(TEXT) TO app_painel;

-- ESCALADA DE PRIVILÉGIO, se o inventário for gravável pela aplicação: as
-- tabelas novas nascem com `arw` para app_painel (ALTER DEFAULT PRIVILEGES do
-- schema). Como fn_por_clinica é SECURITY DEFINER e executa `SELECT %I()` com
-- direitos do dono (que tem BYPASSRLS), quem escreve nesta tabela escolhe o que
-- o wrapper roda como dono. A allowlist só vale se o vigiado não a editar.
REVOKE ALL ON funcao_alcance FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON funcao_alcance FROM app_painel, app_n8n;
GRANT SELECT ON funcao_alcance TO app_painel;

-- ---------------------------------------------------------------------------
-- As duas que a regra 2 reprova: declaram alcance tenant, mas eram DEFINER de
-- dono com BYPASSRLS — rodavam em todas as clínicas de uma vez. Viram INVOKER
-- e passam a exigir tenant, como fn_expirar_ofertas já fazia.
--
-- O corpo é preservado e o `DEFAULT 180` também: fn_por_clinica chama por
-- `SELECT %I()`, e é o default que torna a chamada sem argumentos possível.
-- Removê-lo quebraria a varredura sem erro de compilação.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_expurgo_mensagens(p_dias INT DEFAULT 180)
RETURNS INT LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE n INT;
BEGIN
  PERFORM fn_tenant_atual();   -- falha alto em vez de varrer tudo ou nada
  UPDATE mensagens_bot SET conteudo = NULL, expurgado_em = NOW()
   WHERE expurgado_em IS NULL
     AND ocorrido_em < NOW() - (p_dias || ' days')::interval;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;
REVOKE ALL ON FUNCTION fn_expurgo_mensagens(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_expurgo_mensagens(INT) TO app_painel;
COMMENT ON FUNCTION fn_expurgo_mensagens(INT) IS
  'Job POR TENANT. Alcance declarado em funcao_alcance. Chamar via fn_por_clinica.';

CREATE OR REPLACE FUNCTION fn_expurgo_leads(p_dias INT DEFAULT 180)
RETURNS INT LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE n INT;
BEGIN
  PERFORM fn_tenant_atual();
  UPDATE contatos_whatsapp
     SET nome_lead = NULL, interesse = NULL, segmento = NULL, estado_lead = 'descartado'
   WHERE marketing_optin IS NOT TRUE
     AND estado_lead <> 'convertido'
     AND criado_em < NOW() - (p_dias || ' days')::interval
     AND NOT EXISTS (SELECT 1 FROM paciente_contato pc WHERE pc.contato_id = contatos_whatsapp.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;
REVOKE ALL ON FUNCTION fn_expurgo_leads(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_expurgo_leads(INT) TO app_painel;
COMMENT ON FUNCTION fn_expurgo_leads(INT) IS
  'Job POR TENANT. Alcance declarado em funcao_alcance. Chamar via fn_por_clinica.';

COMMIT;
