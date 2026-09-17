-- ============================================================================
-- 005-tenant-de-job.sql — o wrapper que impede job de falhar em silêncio.
--
-- O PROBLEMA, medido neste banco em 2026-09-01 (não suposto):
--
--   fn_expurgo_mensagens(180) SEM app.clinica_id  ->  expurgou 1 linha
--
-- Ou seja: `SECURITY DEFINER` NÃO fica preso à RLS aqui, porque a função pertence
-- a `neondb_owner` e esse role tem `rolbypassrls = true` — e BYPASSRLS vence
-- FORCE RLS. Isso CORRIGE a nota antiga de que "FORCE vale até para o dono, logo
-- SECURITY DEFINER não escapa": era verdade no Postgres da Railway, onde o dono
-- não tinha bypass. Aqui é o contrário.
--
-- Resultado: os jobs se partem em DUAS classes com falhas OPOSTAS, e nenhuma
-- delas avisa.
--
--   SECURITY DEFINER (dono bypassa)  ->  roda em TODAS as clínicas de uma vez
--   SECURITY INVOKER (app_painel)    ->  0 linhas, em silêncio, retornando sucesso
--
-- A segunda é a mais perigosa em operação: reserva vencida nunca libera, e uma
-- oferta pendente tranca a vaga PARA SEMPRE por causa de uq_oferta_pendente_por_vaga.
-- Ninguém recebe erro. É o "silêncio da bomba d'água".
--
-- O CONSERTO não é disciplina de quem escreve o job — é tirar o default acidental:
--   (a) fn_tenant_atual() FALHA ALTO quando o GUC está vazio;
--   (b) job por tenant chama isso e não roda sem tenant;
--   (c) job que precisa varrer todas as clínicas passa a DECLARAR isso, chamando
--       fn_por_clinica(), que itera setando o GUC clínica a clínica.
-- Cross-tenant vira escolha explícita, nunca o que acontece quando se esquece.
--
-- Idempotente.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- (a) O tenant corrente, ou erro. Nunca NULL silencioso.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tenant_atual()
RETURNS INTEGER LANGUAGE plpgsql STABLE AS $fn$
DECLARE v INTEGER;
BEGIN
  v := NULLIF(current_setting('app.clinica_id', true), '')::int;
  IF v IS NULL THEN
    RAISE EXCEPTION 'app.clinica_id nao definido: job por tenant nao pode rodar sem tenant. Use fn_por_clinica() para varrer todas.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- (c) Varredura declarada. O cron chama ISTO, não a função por tenant.
--
-- SECURITY DEFINER de propósito: precisa enxergar a lista de clínicas. Mas o
-- trabalho de cada volta roda COM o GUC setado, então a função interna continua
-- vendo só uma clínica por vez — a varredura é explícita, o vazamento não.
--
-- p_funcao: nome de função sem argumentos que retorna INTEGER (quantos itens
-- tratou). Ex.: fn_por_clinica('fn_expirar_ofertas').
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_por_clinica(p_funcao TEXT)
RETURNS TABLE(clinica_id INTEGER, resultado INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE c RECORD; n INTEGER;
BEGIN
  -- só nome simples: sem isto, `p_funcao` seria injeção de SQL com direitos de dono.
  IF p_funcao !~ '^[a-z_][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'nome de funcao invalido: %', p_funcao;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = p_funcao) THEN
    RAISE EXCEPTION 'funcao % nao existe', p_funcao;
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
GRANT EXECUTE ON FUNCTION fn_tenant_atual() TO app_painel, app_n8n;

-- ---------------------------------------------------------------------------
-- (b) Os jobs por tenant passam a exigir tenant.
-- fn_expirar_ofertas é SECURITY INVOKER: sem GUC ela varria zero linhas e
-- devolvia 0 como se estivesse tudo em ordem. Agora ela grita.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_expirar_ofertas()
RETURNS INTEGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE r RECORD; n INTEGER := 0;
BEGIN
  PERFORM fn_tenant_atual();   -- falha alto em vez de varrer nada em silêncio
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
GRANT EXECUTE ON FUNCTION fn_expirar_ofertas() TO app_painel, app_n8n;

COMMENT ON FUNCTION fn_expirar_ofertas() IS
  'Job POR TENANT. O cron deve chamar fn_por_clinica(''fn_expirar_ofertas''), nunca esta função direto.';

COMMIT;
