-- ============================================================================
-- 005-chat.sql — a ação que abre o chat.
--
-- O chat em si não é privilégio: os três papéis conversam. O que muda entre
-- eles é o CATÁLOGO de ferramentas, que é derivado de papel_acao em runtime —
-- por isso aqui basta uma ação de entrada, e não uma por módulo exposto.
--
-- Ela existe porque a navegação do painel deriva de MODULOS (src/app/(painel)/
-- modulos.ts), e todo módulo declara a ação que o torna visível. Sem esta
-- linha, o chat precisaria de um `if` à mão no layout — que foi exatamente o
-- que a derivação por catálogo eliminou.
--
-- Idempotente. Roda depois de 001-acesso.sql.
-- ============================================================================

BEGIN;

INSERT INTO acao (chave, modulo, escrita, sensivel, descricao) VALUES
  ('usar_chat', 'chat', FALSE, FALSE, 'Conversar com a assistente do painel')
ON CONFLICT (chave) DO UPDATE SET
  modulo = EXCLUDED.modulo, escrita = EXCLUDED.escrita,
  sensivel = EXCLUDED.sensivel, descricao = EXCLUDED.descricao;

INSERT INTO papel_acao (papel_chave, acao_chave) VALUES
  ('recepcao','usar_chat'), ('medico','usar_chat'), ('admin','usar_chat')
ON CONFLICT DO NOTHING;

COMMIT;
