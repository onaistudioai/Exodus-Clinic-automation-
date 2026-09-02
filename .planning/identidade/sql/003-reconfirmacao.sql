-- 003-reconfirmacao.sql — número reciclado não herda acesso ao paciente
-- anterior (src/server/identidade.repo.ts, resolverIdentidadeConfiavel).
--
-- O FURO: alguém compra um chip que já foi de um paciente. `contatos_whatsapp`
-- já tem `status` (com 'a_reconfirmar' no CHECK) e `verificado_em` desde
-- DRAFT-prontuario-modelo.sql — nenhum código de app lia nenhum dos dois.
--
-- CRITÉRIO ESCOLHIDO (desvio deliberado do desenho antigo do n8n morto, que
-- usava "sem verificação OU sem mensagem há 5 meses"): só `verificado_em`
-- conta. "Sem mensagem" tem um furo que inverte a proteção — quem comprou o
-- número reciclado e começa a conversar com a SOFIA estaria, por esse
-- critério, renovando a própria confiança só de mandar mensagem. O atacante
-- manteria o acesso vivo exatamente pela ação que deveria levantar suspeita.
-- Só o BALCÃO renova confiança; conversar com o bot nunca renova nada.
BEGIN;

/**
 * Regra de confiança do contato — nome único, para não duplicar a mesma
 * condição em toda query que precisar dela (achado real da sessão par na
 * Fase 1: duas cópias verbatim da regra do freio já quase divergiram).
 *
 * STABLE, não IMMUTABLE: depende de now(), que muda.
 *
 * Limiar de CALIBRAÇÃO, não constante mágica: 5 meses sem reconfirmação
 * humana no balcão volta o contato a "desconhecido". Uma clínica com ciclo de
 * retorno mais longo pode querer outro valor — hoje é fixo porque só existe
 * uma calibração pedida.
 */
CREATE OR REPLACE FUNCTION fn_contato_confiavel(p_status text, p_verificado_em timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT p_status = 'ativo'
     AND p_verificado_em IS NOT NULL
     AND p_verificado_em >= now() - interval '5 months';
$$;

-- ---------------------------------------------------------------------------
-- Novo gatilho de escalonamento: reconfirmar_identidade.
--
-- DÍVIDA REGISTRADA (não paga aqui, de propósito — Fase 2 não é refactor de
-- escalonamentos): este CHECK é a mesma dívida que motivou converter os
-- estados de agendamento em tabela+FK (camada-a-v2/007-estados-fonte-unica.sql)
-- — uma lista hardcoded que cresce por ALTER a cada gatilho novo. Não convertida
-- agora porque o escopo desta fase é o freio de reconfirmação, não a arquitetura
-- de escalonamento. Se um próximo gatilho aparecer, é o segundo sinal — converter.
--
-- Nome do constraint pelo padrão default do Postgres para CHECK sem nome
-- explícito na definição original (<tabela>_<coluna>_check).
ALTER TABLE escalonamentos DROP CONSTRAINT IF EXISTS escalonamentos_gatilho_check;
ALTER TABLE escalonamentos ADD CONSTRAINT escalonamentos_gatilho_check CHECK (gatilho IN (
  'sintoma_clinico', 'duvida_clinica', 'midia_para_avaliacao', 'reclamacao',
  'pediu_humano', 'nao_compreendido', 'fora_de_escopo',
  'reconfirmar_identidade'   -- W2e: contato não confiável, precisa do balcão
));

COMMIT;
