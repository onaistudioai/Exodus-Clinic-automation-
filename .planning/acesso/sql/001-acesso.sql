-- ============================================================================
-- 001-acesso.sql — Política de autorização como FONTE ÚNICA no banco.
--
-- Antes: a matriz papel x ação era um literal em src/lib/rbac-matriz.ts, e o
-- tipo `Papel` estava duplicado em session.ts. Um chat que expõe todos os
-- módulos seria o terceiro lugar a reescrever a mesma lista. Mesmo remédio que
-- estado_agendamento/transicao_agendamento aplicaram aos estados: a lista vira
-- dado, e o código vira lookup.
--
-- TABELAS DE REGRA, NÃO DE TENANT: papel, acao e papel_acao descrevem a
-- política do produto, não dados de uma clínica. Por isso NÃO têm clinica_id e
-- NÃO entram na RLS de tenant (001-lockdown.sql varre por clinica_id e vai
-- ignorá-las corretamente). Elas pertencem à família do
-- seguranca/007-fonte-da-verdade-somente-leitura.sql: legíveis por app_painel,
-- nunca graváveis em runtime. Ver 003-contract-test.sql, que prova isso.
--
-- Idempotente. Aplicar via sofia-demo/sql/_run-sql.mjs (dono = app_n8n).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- papel — os papéis do produto. A CHAVE não muda (está em JWT vivo, em SQL e
-- em ~19 call sites); o `rotulo` é onde mora o vocabulário do usuário final.
-- Renomear a chave seria migração de sessão; renomear o rótulo é um UPDATE.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS papel (
  chave   TEXT PRIMARY KEY,
  rotulo  TEXT NOT NULL,
  ordem   SMALLINT NOT NULL,          -- ordem de exibição, não hierarquia
  CONSTRAINT chk_papel_rotulo CHECK (length(btrim(rotulo)) > 0)
);

INSERT INTO papel (chave, rotulo, ordem) VALUES
  ('recepcao', 'Recepcionista', 1),
  ('medico',   'Profissional',  2),
  ('admin',    'Dono',          3)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, ordem = EXCLUDED.ordem;

-- ---------------------------------------------------------------------------
-- acao — o vocabulário de ações. `escrita` e `sensivel` existem para que o
-- comportamento seja DERIVADO em vez de escrito à mão em cada consumidor:
--   escrita  -> o chat confirma antes de executar
--   sensivel -> negar não basta; vira pedido de aprovação (004-aprovacao.sql)
-- `descricao` alimenta o catálogo de ferramentas do chat. Se a descrição fosse
-- mantida no TypeScript, o catálogo seria a próxima cópia a divergir.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS acao (
  chave      TEXT PRIMARY KEY,
  modulo     TEXT NOT NULL,
  escrita    BOOLEAN NOT NULL,
  sensivel   BOOLEAN NOT NULL DEFAULT FALSE,
  descricao  TEXT NOT NULL,
  CONSTRAINT chk_acao_descricao CHECK (length(btrim(descricao)) > 0),
  -- Uma ação de leitura nunca é "sensível" no sentido de exigir aprovação:
  -- não há o que aprovar num SELECT. Impede a combinação sem sentido.
  CONSTRAINT chk_sensivel_implica_escrita CHECK (NOT sensivel OR escrita)
);

INSERT INTO acao (chave, modulo, escrita, sensivel, descricao) VALUES
  ('checkin',                  'checkin',       TRUE,  FALSE, 'Fazer check-in de paciente na recepção'),
  ('ler_texto_clinico',        'prontuario',    FALSE, FALSE, 'Ler o texto clínico do prontuário'),
  ('criar_entrada_prontuario', 'prontuario',    TRUE,  TRUE,  'Registrar atendimento no prontuário'),
  ('expurgo_logico',           'lgpd',          TRUE,  TRUE,  'Expurgo lógico de dados do titular (LGPD art. 18)'),
  ('ver_auditoria',            'auditoria',     FALSE, FALSE, 'Consultar a trilha de auditoria'),
  ('ver_estoque',              'estoque',       FALSE, FALSE, 'Consultar níveis de estoque e alertas'),
  ('gerir_estoque',            'estoque',       TRUE,  TRUE,  'Dar entrada, ajustar inventário e gerir produtos'),
  ('configurar_bom',           'estoque',       TRUE,  FALSE, 'Configurar a composição (BOM) de kits e procedimentos'),
  ('ver_reativacao',           'reativacao',    FALSE, FALSE, 'Consultar público e métricas de reativação'),
  ('gerir_reativacao',         'reativacao',    TRUE,  FALSE, 'Criar campanhas e disparar reativação'),
  ('ver_financeiro',           'financeiro',    FALSE, FALSE, 'Consultar caixa e recebíveis'),
  ('gerir_financeiro',         'financeiro',    TRUE,  TRUE,  'Definir preço, registrar pagamento e cancelar cobrança'),
  ('ver_agenda',               'agenda',        FALSE, FALSE, 'Consultar calendário e disponibilidade'),
  ('gerir_agenda',             'agenda',        TRUE,  FALSE, 'Marcar, remarcar e mudar status de agendamento'),
  ('gerir_escala',             'agenda',        TRUE,  FALSE, 'Gerir profissionais, serviços e turnos'),
  ('ver_crm',                  'crm',           FALSE, FALSE, 'Consultar tarefas e ficha de relacionamento'),
  ('gerir_crm',                'crm',           TRUE,  FALSE, 'Criar, concluir tarefas e marcar contato'),
  ('ver_escalonamento',        'escalonamento', FALSE, FALSE, 'Ver a fila de escalonamento para atendimento humano'),
  ('gerir_escalonamento',      'escalonamento', TRUE,  FALSE, 'Atender e resolver itens da fila de escalonamento')
ON CONFLICT (chave) DO UPDATE SET
  modulo = EXCLUDED.modulo, escrita = EXCLUDED.escrita,
  sensivel = EXCLUDED.sensivel, descricao = EXCLUDED.descricao;

-- ---------------------------------------------------------------------------
-- papel_acao — A MATRIZ. Uma linha por par PERMITIDO; ausência é negação.
-- Fail-closed por construção: ação sem nenhuma linha aqui é negada para todos,
-- inclusive uma ação recém-inserida em `acao` que alguém esqueceu de liberar.
--
-- Conteúdo idêntico ao literal MATRIZ de src/lib/rbac-matriz.ts nesta data.
-- 002-verify.sql prova essa igualdade — é o arquivo que impede a migração de
-- mudar a política em silêncio.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS papel_acao (
  papel_chave  TEXT NOT NULL REFERENCES papel (chave) ON DELETE RESTRICT,
  acao_chave   TEXT NOT NULL REFERENCES acao  (chave) ON DELETE CASCADE,
  PRIMARY KEY (papel_chave, acao_chave)
);

-- lookup do gate: "todas as ações deste papel", uma leitura por request.
CREATE INDEX IF NOT EXISTS idx_papel_acao_papel ON papel_acao (papel_chave);

INSERT INTO papel_acao (papel_chave, acao_chave) VALUES
  ('recepcao','checkin'),                 ('admin','checkin'),
  ('medico','ler_texto_clinico'),         ('admin','ler_texto_clinico'),
  -- criar_entrada_prontuario é só do médico: admin NÃO escreve no prontuário.
  ('medico','criar_entrada_prontuario'),
  ('admin','expurgo_logico'),
  ('admin','ver_auditoria'),
  ('recepcao','ver_estoque'),             ('medico','ver_estoque'),         ('admin','ver_estoque'),
  ('recepcao','gerir_estoque'),           ('admin','gerir_estoque'),
  ('admin','configurar_bom'),
  ('recepcao','ver_reativacao'),          ('medico','ver_reativacao'),      ('admin','ver_reativacao'),
  ('recepcao','gerir_reativacao'),        ('admin','gerir_reativacao'),
  ('recepcao','ver_financeiro'),          ('medico','ver_financeiro'),      ('admin','ver_financeiro'),
  ('recepcao','gerir_financeiro'),        ('admin','gerir_financeiro'),
  ('recepcao','ver_agenda'),              ('medico','ver_agenda'),          ('admin','ver_agenda'),
  ('recepcao','gerir_agenda'),            ('admin','gerir_agenda'),
  ('admin','gerir_escala'),
  ('recepcao','ver_crm'),                 ('medico','ver_crm'),             ('admin','ver_crm'),
  ('recepcao','gerir_crm'),               ('admin','gerir_crm'),
  -- Escalonamento: o médico VÊ (o gatilho é clínico) e a recepção RESOLVE.
  -- Ninguém apaga — o histórico prova o Anexo I §5.
  ('recepcao','ver_escalonamento'),       ('medico','ver_escalonamento'),   ('admin','ver_escalonamento'),
  ('recepcao','gerir_escalonamento'),     ('medico','gerir_escalonamento'), ('admin','gerir_escalonamento')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Leitura para a aplicação. A ESCRITA fica de fora de propósito: app_painel
-- não reescreve a própria política em runtime. O seguranca/004 dá GRANT amplo
-- em ALL TABLES e reabriria isto — por isso estas três tabelas precisam entrar
-- na lista do seguranca/007, que roda depois e retranca.
-- ---------------------------------------------------------------------------
GRANT SELECT ON papel, acao, papel_acao TO app_painel;

COMMIT;
