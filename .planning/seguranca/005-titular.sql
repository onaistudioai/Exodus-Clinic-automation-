-- 005-titular.sql — direitos do titular (LGPD art. 18) + expurgo por retenção.
--
-- Fecha o item que o ROPA prometia e o sistema não tinha: prazos de retenção
-- declarados, mas nenhuma rotina que os cumprisse, e nenhum caminho para
-- atender pedido de acesso/eliminação.
--
-- A decisão que estrutura este arquivo: ELIMINAÇÃO NÃO É DELETE.
-- O prontuário tem retenção mínima de 20 anos (norma do CFM) e o art. 16, I da
-- LGPD ressalva expressamente a guarda por obrigação legal — ela PREVALECE sobre
-- o pedido de eliminação. Apagar o paciente no ato do pedido seria trocar uma
-- infração por outra. Então o pedido:
--   (1) elimina JÁ o que não tem base legal remanescente — o canal e o marketing;
--   (2) REGISTRA o pedido na identidade, com data;
--   (3) deixa o expurgo real do prontuário para fn_expurgo_retencao(), que só age
--       quando o prazo legal vence de fato.
-- O recibo devolvido ao admin diz exatamente isso, para ser repassado ao titular.
--
-- RODA DEPOIS de 004-auth-e-grants.sql e das migrações de módulo (reativação 004,
-- financeiro 001).
BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- (1) O pedido fica gravado na identidade, não num ticket fora do sistema.
--     Sem isto, o expurgo por retenção não tem como saber de quem expurgar:
--     vencer o prazo não autoriza apagar quem nunca pediu nada.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS eliminacao_pedida_em  TIMESTAMPTZ;
ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS eliminacao_pedida_por INTEGER REFERENCES usuarios(id);
ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS eliminacao_motivo     TEXT;
ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS anonimizado_em        TIMESTAMPTZ;

COMMENT ON COLUMN pacientes.eliminacao_pedida_em IS
  'Art. 18 VI: quando o titular pediu eliminação. Canal e marketing saem na hora; '
  'identidade e prontuário só depois do prazo legal (fn_expurgo_retencao).';
COMMENT ON COLUMN pacientes.anonimizado_em IS
  'Quando fn_expurgo_retencao() de fato desidentificou a linha. NULL = pedido pendente de prazo.';

-- Fila do job: quem pediu e ainda não foi anonimizado.
CREATE INDEX IF NOT EXISTS ix_pac_eliminacao_pendente
  ON pacientes (clinica_id, eliminacao_pedida_em)
  WHERE eliminacao_pedida_em IS NOT NULL AND anonimizado_em IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- (2) fn_titular_eliminar — atende o pedido do titular.
--
-- SECURITY INVOKER de propósito: roda dentro do withTenant() do painel, sob RLS,
-- e o RBAC (`expurgo_logico`, admin-only) é aplicado antes, na Action. Um
-- DEFINER aqui só ampliaria a superfície sem necessidade.
--
-- Idempotente: pedido repetido não duplica opt-out (registrar_consentimento já
-- trata opt-out como porta de mão única) nem reescreve a data do primeiro pedido.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_titular_eliminar(
  p_paciente_id INTEGER,
  p_motivo      TEXT,
  p_usuario_id  INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant       INTEGER := current_setting('app.clinica_id')::int;
  v_nome         TEXT;
  v_ja_pedido    TIMESTAMPTZ;
  v_contatos     INTEGER := 0;
  v_optouts      INTEGER := 0;
  v_prontuarios  INTEGER := 0;
  v_libera_em    DATE;
  r              RECORD;
BEGIN
  SELECT nome_completo, eliminacao_pedida_em INTO v_nome, v_ja_pedido
    FROM pacientes WHERE id = p_paciente_id AND clinica_id = v_tenant;

  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'paciente % não encontrado nesta clínica', p_paciente_id;
  END IF;

  -- (a) Canal: revoga o vínculo paciente↔número. O NÚMERO em si não é apagado —
  --     um telefone pode servir a outro paciente ativo (mãe e filho no mesmo
  --     WhatsApp); apagá-lo cortaria o atendimento de terceiro.
  UPDATE paciente_contato
     SET vinculo_status = 'revogado',
         revogado_em = NOW(),
         revogado_motivo = 'eliminacao_titular'
   WHERE paciente_id = p_paciente_id
     AND clinica_id = v_tenant
     AND vinculo_status = 'ativo';
  GET DIAGNOSTICS v_contatos = ROW_COUNT;

  -- (b) Marketing: opt-out por número, com prova. Só nos números que não
  --     sobraram vinculados a outro paciente ativo — opt-out alheio é dano.
  FOR r IN
    SELECT DISTINCT c.chat_id
      FROM contatos_whatsapp c
      JOIN paciente_contato pc ON pc.contato_id = c.id AND pc.clinica_id = v_tenant
     WHERE pc.paciente_id = p_paciente_id
       AND c.clinica_id = v_tenant
       AND NOT EXISTS (
         SELECT 1 FROM paciente_contato o
          WHERE o.contato_id = c.id
            AND o.clinica_id = v_tenant
            AND o.paciente_id <> p_paciente_id
            AND o.vinculo_status = 'ativo'
       )
  LOOP
    IF registrar_consentimento(
         r.chat_id, 'optout', 'painel',
         format('eliminação art. 18 VI, paciente %s, usuário %s', p_paciente_id, p_usuario_id)
       ) THEN
      v_optouts := v_optouts + 1;
    END IF;
  END LOOP;

  -- (c) O que a lei manda guardar. A data de liberação é a do prontuário mais
  --     recente + 20 anos; sem prontuário, cai no prazo geral de 5 anos do
  --     agendamento (ROPA §1).
  SELECT count(*), max(GREATEST(finalizado_em, criado_em))::date + interval '20 years'
    INTO v_prontuarios, v_libera_em
    FROM prontuario_entradas
   WHERE paciente_id = p_paciente_id AND clinica_id = v_tenant AND expurgado = false;

  IF v_prontuarios = 0 THEN
    SELECT max(data_agendamento) + interval '5 years' INTO v_libera_em
      FROM agendamentos_sofia_demo
     WHERE paciente_id = p_paciente_id AND clinica_id = v_tenant;
    v_libera_em := COALESCE(v_libera_em, CURRENT_DATE);
  END IF;

  -- (d) Registra o pedido e arquiva. Preserva a data do PRIMEIRO pedido.
  UPDATE pacientes
     SET status = 'arquivado',
         eliminacao_pedida_em  = COALESCE(eliminacao_pedida_em, NOW()),
         eliminacao_pedida_por = COALESCE(eliminacao_pedida_por, p_usuario_id),
         eliminacao_motivo     = COALESCE(eliminacao_motivo, p_motivo),
         atualizado_em = NOW()
   WHERE id = p_paciente_id AND clinica_id = v_tenant;

  -- (e) Trilha: o pedido é um evento auditável como qualquer acesso clínico.
  INSERT INTO prontuario_acessos (clinica_id, usuario_id, paciente_id, acao, detalhe)
  VALUES (v_tenant, p_usuario_id, p_paciente_id, 'expurgou',
          format('eliminação art. 18 VI: %s', COALESCE(p_motivo, 'sem motivo informado')));

  RETURN jsonb_build_object(
    'paciente_id',            p_paciente_id,
    'pedido_em',              COALESCE(v_ja_pedido, NOW()),
    'ja_havia_pedido',        v_ja_pedido IS NOT NULL,
    'vinculos_revogados',     v_contatos,
    'optouts_registrados',    v_optouts,
    'prontuarios_retidos',    v_prontuarios,
    'retencao_legal_ate',     v_libera_em,
    'base_da_retencao',       CASE WHEN v_prontuarios > 0
                                   THEN 'prontuário: 20 anos (CFM) — LGPD art. 16, I'
                                   ELSE 'agendamento: 5 anos — ROPA §1' END
  );
END $$;

REVOKE ALL ON FUNCTION fn_titular_eliminar(INTEGER, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_titular_eliminar(INTEGER, TEXT, INTEGER) TO app_painel;

-- ───────────────────────────────────────────────────────────────────────────
-- (3) fn_expurgo_retencao — o relógio. Roda por cron; devolve o que fez.
--
-- SECURITY DEFINER porque app_painel não tem DELETE em nada (004, §1) e não é
-- para ter: expurgo é operação do sistema, não do usuário logado. search_path
-- fixo pelo mesmo motivo do fn_login_lookup.
--
-- NÃO varre tenant por tenant: prazo legal não é multi-tenant, vence igual para
-- todos. Por isso ignora o GUC e não pode ser chamada por rota autenticada de
-- clínica — só pelo cron.
--
-- DELIBERADAMENTE NÃO expurga: prontuario_acessos (trilha de auditoria, sem
-- prazo declarado no ROPA — apagar prova de acesso é pior que guardá-la),
-- financeiro_lancamentos e reativacao_envios (append-only por trigger; o prazo
-- de 5 anos do ROPA vence a partir de 2031 e o dado não é identificável sozinho).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_expurgo_retencao()
RETURNS TABLE (alvo TEXT, afetados INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  n     INTEGER;
  total INTEGER := 0;
  c     INTEGER;
BEGIN
  -- (a) Registros de segurança: 30 dias (ROPA §7).
  --     Sem clinica_id, logo fora da RLS — DELETE direto funciona.
  DELETE FROM login_tentativas WHERE criado_em < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN QUERY SELECT 'login_tentativas'::text, n;

  -- (b) Titulares que pediram eliminação E cujo prazo legal já venceu.
  --
  --     PRECISA percorrer clínica por clínica setando o GUC: as tabelas têm
  --     FORCE ROW LEVEL SECURITY, e FORCE vale até para o dono — o SECURITY
  --     DEFINER não escapa da policy. Sem set_config, o DELETE veria 0 linhas e
  --     o job "passaria" sem expurgar nada. Fail-closed cobra esse preço.
  FOR c IN SELECT id FROM clinicas LOOP
    PERFORM set_config('app.clinica_id', c::text, true);

    -- Aqui sim é expurgo de conteúdo: desidentifica a linha e apaga o texto
    -- clínico. A LINHA sobrevive porque o prontuário é append-only e há FKs
    -- (cobranças, agendamentos) — órfã não é anonimização, é corrupção.
    WITH vencidos AS (
      SELECT p.id
        FROM pacientes p
       WHERE p.eliminacao_pedida_em IS NOT NULL
         AND p.anonimizado_em IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM prontuario_entradas e
            WHERE e.paciente_id = p.id
              AND e.expurgado = false
              AND GREATEST(e.finalizado_em, e.criado_em) > now() - interval '20 years'
         )
         AND NOT EXISTS (
           SELECT 1 FROM agendamentos_sofia_demo a
            WHERE a.paciente_id = p.id
              AND a.data_agendamento > (now() - interval '5 years')::date
         )
    ), limpa_prontuario AS (
      UPDATE prontuario_entradas e
         SET expurgado = true, expurgado_em = NOW(),
             expurgo_motivo = 'retenção vencida (art. 18 VI)',
             texto_clinico = NULL, orientacoes_paciente = NULL
       WHERE e.paciente_id IN (SELECT id FROM vencidos) AND e.expurgado = false
      RETURNING 1
    ), limpa_identidade AS (
      UPDATE pacientes p
         SET nome_completo = format('TITULAR ELIMINADO #%s', p.id),
             cpf_hash = NULL,
             cpf_last4 = NULL,
             anonimizado_em = NOW(),
             atualizado_em = NOW()
       WHERE p.id IN (SELECT id FROM vencidos)
      RETURNING 1
    )
    -- CTE que modifica dado executa mesmo sem ser referenciada na query
    -- principal (Postgres garante isso): limpa_prontuario roda sem aparecer aqui.
    SELECT count(*)::int INTO n FROM limpa_identidade;
    total := total + n;
  END LOOP;

  PERFORM set_config('app.clinica_id', '', true);
  RETURN QUERY SELECT 'pacientes_anonimizados'::text, total;
END $$;

REVOKE ALL ON FUNCTION fn_expurgo_retencao() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_expurgo_retencao() TO app_painel;

COMMIT;
