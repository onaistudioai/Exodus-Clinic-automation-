-- ============================================================================
-- 001-guardrail.sql — Camada A v2, item 1 (§6): o cinto de segurança.
--
-- TESE 9 — o bot precisa saber quando desistir, e a recusa tem que ser
-- VERIFICAÇÃO SEPARADA, não instrução no prompt. Instrução se contorna; um
-- booleano consultado antes do fluxo não.
--
-- O QUE JÁ EXISTIA: reativacao/007 criou `escalonamentos` (os 7 gatilhos do
-- Anexo I §5, anti-flood por chat, RLS) e `abrir_escalonamento()`. O pouso da
-- escalada estava pronto — o que faltava era QUEM chama. Nenhum workflow n8n
-- referencia a tabela: cláusula de contrato declarada e nunca cumprida.
--
-- Depende de: reativacao/007-escalonamentos.sql. Idempotente.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- fn_triagem_clinica — piso determinístico. Devolve o gatilho (mesmo domínio do
-- CHECK de escalonamentos) ou NULL.
--
-- HONESTIDADE SOBRE O ALCANCE: um léxico não é um detector completo. Ele garante
-- que a família óbvia de frase clínica nunca chegue ao bot; não garante que
-- nenhuma chegue. Por isso ele é METADE do guardrail — a outra metade é
-- fn_chat_bloqueado, que impede a SEGUNDA resposta errada.
--
-- ponytail: léxico embutido, não tabela por tenant. Vira tenant_config quando o
-- item 7 do §11 for construído; hoje seria tabela com uma linha só.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_triagem_clinica(p_texto TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE t TEXT;
BEGIN
  IF p_texto IS NULL OR btrim(p_texto) = '' THEN RETURN NULL; END IF;

  -- normaliza: minúsculas e sem acento. Sem isto, "está doendo" escapa de "doendo"
  -- e o guardrail vira decoração — o mesmo motivo da regra de normalização da v1 §7.
  t := lower(translate(p_texto,
        'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
        'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'));

  -- ORDEM IMPORTA: o gatilho mais grave ganha. Uma frase pode bater em dois.
  IF t ~ '(sangra|sangue|inchad|inchaco|febre|pus|abscesso|infecc|alergi|reacao|urgen|emergen|socorro|nao para de|desmai)' THEN
    RETURN 'sintoma_clinico';
  END IF;
  IF t ~ '(dor|doendo|doi |doi$|doeu|ardend|latejand|incomod)' THEN
    RETURN 'sintoma_clinico';
  END IF;
  IF t ~ '(antibiotic|remedi|medicament|dipirona|ibuprofen|amoxicilin|anestesi|dosagem|posso tomar|pode tomar|tomar junto)' THEN
    RETURN 'duvida_clinica';
  END IF;
  IF t ~ '(e normal|é normal|e grave|é grave|é perigos|e perigos|isso ai e|caroco|mancha|ferida|cicatriz|pos.?operator|depois da cirurgia)' THEN
    RETURN 'duvida_clinica';
  END IF;

  RETURN NULL;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- fn_chat_bloqueado — A TRAVA. Escalada é porta de mão única: enquanto houver
-- item aberto para o chat, o bot não responde NADA. O n8n consulta isto antes
-- de qualquer coisa.
--
-- Por que isto e não uma regra no prompt: o modelo pode ignorar a regra; não
-- pode ignorar um IF que decide se ele chega a ser chamado.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_chat_bloqueado(p_chat_id TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM escalonamentos
     WHERE chat_id = p_chat_id
       AND status <> 'resolvido'
  );
$fn$;

-- ---------------------------------------------------------------------------
-- fn_guardrail — o ponto único que o n8n chama. Decide e já registra, para não
-- existir caminho em que o sistema "reconhece mas não escala".
--
-- Devolve {bloqueado, gatilho, escalonamento_id}. bloqueado=true ⇒ o fluxo
-- normal NÃO roda; o n8n manda acolhimento e encerra.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_guardrail(p_chat_id TEXT, p_texto TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE v_gatilho TEXT; v_id BIGINT;
BEGIN
  -- 1) já escalado? porta de mão única, nem classifica de novo.
  IF fn_chat_bloqueado(p_chat_id) THEN
    SELECT id INTO v_id FROM escalonamentos
     WHERE chat_id = p_chat_id AND status <> 'resolvido'
     ORDER BY id DESC LIMIT 1;
    RETURN jsonb_build_object('bloqueado', true, 'gatilho', 'ja_escalado', 'escalonamento_id', v_id);
  END IF;

  -- 2) triagem. abrir_escalonamento (reativacao/007) já é idempotente por chat.
  v_gatilho := fn_triagem_clinica(p_texto);
  IF v_gatilho IS NOT NULL THEN
    v_id := abrir_escalonamento(p_chat_id, v_gatilho, left(p_texto, 500));
    RETURN jsonb_build_object('bloqueado', true, 'gatilho', v_gatilho, 'escalonamento_id', v_id);
  END IF;

  RETURN jsonb_build_object('bloqueado', false, 'gatilho', NULL, 'escalonamento_id', NULL);
END;
$fn$;

GRANT EXECUTE ON FUNCTION fn_triagem_clinica(TEXT), fn_chat_bloqueado(TEXT),
                          fn_guardrail(TEXT, TEXT) TO app_painel, app_n8n;

COMMIT;
