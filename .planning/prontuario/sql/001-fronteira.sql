-- ===================================================================
-- Prontuário 001 — FRONTEIRA DE DOMÍNIO
--
-- Achado #3 de docs/RELATORIOS/MAPA-OPERACAO.md: crm, estoque, financeiro e
-- pacientes liam `prontuario_entradas` direto. A regra de leitura clínica
-- morava em 5 lugares e já tinha divergido (estoque/financeiro não filtravam
-- `expurgado`). Estas duas views passam a ser a ÚNICA porta de entrada de quem
-- não é o Prontuário — e, por não terem `texto_clinico`, tornam o vazamento
-- de texto clínico estruturalmente impossível em vez de só improvável.
--
-- Observação RLS (CRÍTICO): view é criada pelo DONO (superuser, que BYPASSA
-- RLS). Sem security_invoker ela rodaria com os direitos do dono → app_painel
-- enxergaria TODAS as clínicas (furo de isolamento). `security_invoker = true`
-- (PG 15+) faz a view rodar com os direitos de QUEM consulta: sob app_painel a
-- RLS FORCE de `prontuario_entradas` aplica e ela vê só a clínica do GUC.
-- Mesmo padrão de .planning/estoque/sql/004-falhas-fixes.sql.
-- ===================================================================
BEGIN;

-- -------------------------------------------------------------------
-- Fronteira de LEITURA. Consumidores: crm.repo, pacientes.repo e o próprio
-- prontuario.repo (listarEtiquetas) — a view É a definição de "entrada visível".
-- Sem texto_clinico e sem orientacoes_paciente: quem precisa deles chama o dono.
-- -------------------------------------------------------------------
CREATE OR REPLACE VIEW v_prontuario_visivel
  WITH (security_invoker = true) AS
SELECT id, clinica_id, paciente_id, agendamento_id, profissional_id,
       estado, tipo_atendimento, precisa_retorno, retorno_em_dias,
       criado_em, finalizado_em
  FROM prontuario_entradas
 WHERE expurgado = false;

-- -------------------------------------------------------------------
-- Série para INDICADOR de custo/margem (estoque.custoPorProcedimento,
-- financeiro.margemPorProcedimento).
--
-- NÃO filtra `expurgado`, e isso é PROPOSITAL — não é esquecimento, não
-- "conserte". O expurgo LGPD anula o texto clínico, mas o material FOI
-- consumido e a cobrança FOI emitida. Excluir a entrada zeraria custo de
-- insumo real e distorceria a margem: some com dinheiro que existiu.
-- Por isso só carrega a chave e a dimensão de agregação, nada mais.
-- -------------------------------------------------------------------
CREATE OR REPLACE VIEW v_prontuario_indicador
  WITH (security_invoker = true) AS
SELECT id, clinica_id, tipo_atendimento, criado_em
  FROM prontuario_entradas;

GRANT SELECT ON v_prontuario_visivel   TO app_painel;
GRANT SELECT ON v_prontuario_indicador TO app_painel;

COMMIT;
