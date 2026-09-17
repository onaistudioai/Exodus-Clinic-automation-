-- ============================================================================
-- 002-verify.sql — prova que a matriz NO BANCO é idêntica à MATRIZ que estava
-- em src/lib/rbac-matriz.ts no momento da migração.
--
-- Por que este arquivo existe: o pior resultado possível da Etapa 1 não é
-- falhar, é PASSAR tendo mudado a política em silêncio — alguém ganhar
-- 'gerir_financeiro' porque uma linha foi digitada errada no INSERT. Um
-- CREATE TABLE bem-sucedido não prova nada sobre o CONTEÚDO.
--
-- A lista abaixo é uma CÓPIA DELIBERADA e CONGELADA do literal antigo. É o
-- único lugar do repo onde duplicar a matriz é correto: ela existe justamente
-- para ser comparada com a fonte única, e não é lida por nenhum código em
-- runtime. Depois que a migração for aceita, este arquivo é histórico — não o
-- atualize quando a política mudar; mudança de política se faz na tabela.
--
-- ACHADO (2026-09-01, antes da primeira execução): a versão anterior deste
-- arquivo devolvia LINHAS 'FALHA:' em vez de levantar exceção. O runner
-- (scripts/test-db.mjs) só detecta falha por erro de SQL, então ele teria
-- passado em silêncio com a política errada — o mesmo defeito de "existe e
-- nunca acusa" que motivou a consolidação dos runners. Agora é RAISE.
--
-- BEGIN ... ROLLBACK: não escreve nada.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_par text;
  v_n   int;
BEGIN
  CREATE TEMP TABLE esperado (papel_chave text, acao_chave text) ON COMMIT DROP;
  INSERT INTO esperado VALUES
    ('recepcao','checkin'),                 ('admin','checkin'),
    ('medico','ler_texto_clinico'),         ('admin','ler_texto_clinico'),
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
    ('recepcao','ver_escalonamento'),       ('medico','ver_escalonamento'),   ('admin','ver_escalonamento'),
    ('recepcao','gerir_escalonamento'),     ('medico','gerir_escalonamento'), ('admin','gerir_escalonamento');

  -- ==========================================================================
  -- (1) PERMISSÃO PERDIDA: estava no TypeScript e sumiu do banco.
  -- ==========================================================================
  SELECT string_agg(papel_chave || '/' || acao_chave, ', '), count(*)
    INTO v_par, v_n
    FROM (SELECT * FROM esperado EXCEPT SELECT papel_chave, acao_chave FROM papel_acao) d;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'FALHA(1): permissao perdida na migracao: %', v_par;
  END IF;

  -- ==========================================================================
  -- (2) PERMISSÃO GANHA — o lado perigoso: alguém recebendo acesso que não
  --     tinha ontem. Escopado às 19 ações originais, porque ação criada DEPOIS
  --     da migração é recurso novo, não regressão; sem o escopo este arquivo
  --     acusaria falha a cada funcionalidade adicionada.
  -- ==========================================================================
  SELECT string_agg(papel_chave || '/' || acao_chave, ', '), count(*)
    INTO v_par, v_n
    FROM (
      SELECT papel_chave, acao_chave FROM papel_acao
       WHERE acao_chave IN (SELECT acao_chave FROM esperado)
      EXCEPT SELECT papel_chave, acao_chave FROM esperado
    ) g;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'FALHA(2): permissao GANHA na migracao (acesso indevido): %', v_par;
  END IF;

  -- ==========================================================================
  -- (3) AÇÃO ÓRFÃ: existe em `acao` mas nenhum papel a executa. Fail-closed
  --     funciona (negada para todos), mas é quase sempre esquecimento.
  -- ==========================================================================
  SELECT string_agg(a.chave, ', '), count(*) INTO v_par, v_n
    FROM acao a
   WHERE NOT EXISTS (SELECT 1 FROM papel_acao pa WHERE pa.acao_chave = a.chave);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'FALHA(3): acao sem nenhum papel: %', v_par;
  END IF;

  -- ==========================================================================
  -- (4) SOBREVIVÊNCIA das 19 originais. Não uma contagem exata: o sistema
  --     ganha ações com o tempo, e `count(*) = 19` viraria falso alarme.
  -- ==========================================================================
  SELECT string_agg(e.acao_chave, ', '), count(*) INTO v_par, v_n
    FROM (SELECT DISTINCT acao_chave FROM esperado) e
   WHERE NOT EXISTS (SELECT 1 FROM acao a WHERE a.chave = e.acao_chave);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'FALHA(4): acao original desapareceu: %', v_par;
  END IF;

  SELECT string_agg(p.chave, ', '), count(*) INTO v_par, v_n
    FROM (VALUES ('recepcao'),('medico'),('admin')) AS p(chave)
   WHERE NOT EXISTS (SELECT 1 FROM papel WHERE papel.chave = p.chave);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'FALHA(4b): papel desapareceu: %', v_par;
  END IF;

  RAISE NOTICE 'OK  acesso/002-verify: matriz no banco identica ao literal migrado';
END $$;

ROLLBACK;
