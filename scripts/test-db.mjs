/**
 * test:db — monta o schema do ZERO e roda todos os contract-tests SQL.
 *
 * POR QUE ISTO EXISTE: a camada de contrato do banco já era boa em estrutura
 * (cada arquivo abre transação, faz asserções com RAISE EXCEPTION e dá ROLLBACK,
 * que é o mesmo formato do pgTAP) e péssima em automação — rodava à mão, arquivo
 * por arquivo, contra um branch criado na hora. Por isso, na prática, não rodava.
 *
 * A ORDEM DOS MÓDULOS vem de `.planning/seguranca/schema-modulos.mjs` — a MESMA
 * fonte que `verify.mjs` usa em produção.
 *
 * ACHADO (2026-09-01): antes desta unificação, este arquivo listava os módulos
 * à mão, e cobria só 5 dos 9 que têm sql/ — crm, estoque, financeiro e
 * prontuario ficavam de fora, então seus contract-tests nunca tinham onde
 * rodar. E a ordem relativa dos 5 que cobria batia com a de verify.mjs só por
 * coincidência: eram duas listas escritas por mãos diferentes, em momentos
 * diferentes, sem nada que as impedisse de divergir — o mesmo defeito de
 * "duas fontes" que motivou toda a correção de estados de hoje. Consolidado:
 * agora é estruturalmente impossível as ordens discordarem, porque só existe
 * uma lista.
 *
 * O que continua explícito aqui, fora da fonte compartilhada, porque não é
 * "módulo com .planning/<nome>/sql": o prelúdio de `clinicas`+seed, os arquivos
 * de `sofia-demo/sql/` que antecedem o loop de módulos, e a cauda de
 * `seguranca/` — que precisa especificamente terminar em `007` (ver o
 * comentário ali, e o equivalente em verify.mjs).
 *
 * Uso:  DATABASE_URL=postgres://... node scripts/test-db.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { construirPassosDosModulos } from "../.planning/seguranca/schema-modulos.mjs";

const URL = process.env.DATABASE_URL;
if (!URL) {
  console.error("DATABASE_URL ausente. Aponte para um banco DESCARTÁVEL — este script cria schema.");
  process.exit(1);
}

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const P = (...p) => path.join(RAIZ, ...p);
const PLAN = (...p) => P("aios-painel", ".planning", ...p);
const PAINEL = P("aios-painel");

// clinicas é a única coisa aproveitável de sql/schema-consultas.sql: o resto do
// arquivo tem uma tabela `pacientes` ANTIGA e incompatível com a do prontuário.
//
// ACHADO (2026-09-01, na prova de idempotência DESTE runner, run 2 contra o
// mesmo banco): `setval('clinicas_id_seq', 10, true)` incondicional resetava a
// sequência para 10 em TODA execução. Inofensivo enquanto nada além de 1/2
// ficava commitado além do id 10 — mas o seed nomeado ('[TESTE] Clinica A'/B,
// mais abaixo) COMMITA clínicas novas via nextval(). Na run 2, o reset para 10
// colidia com o id 11 que a run 1 já tinha deixado gravado: "duplicate key
// value violates unique constraint clinicas_pkey" dentro de
// seguranca/006-contract-test-titular.sql, que só faz outro INSERT comum.
// GREATEST nunca deixa a sequência andar PARA TRÁS do que já existe — 10
// continua sendo o piso na primeira vez, e o teto real manda depois disso.
const CLINICAS = `
CREATE TABLE IF NOT EXISTS clinicas (
  id SERIAL PRIMARY KEY, nome TEXT NOT NULL, telefone TEXT, endereco TEXT,
  horario_func TEXT, convenios TEXT, criado_em TIMESTAMPTZ DEFAULT NOW());
INSERT INTO clinicas (id, nome) VALUES (1,'Clinica 1'),(2,'Clinica Bella')
  ON CONFLICT (id) DO NOTHING;
SELECT setval('clinicas_id_seq', GREATEST(10, (SELECT COALESCE(MAX(id), 0) FROM clinicas)), true);`;

const BASE = [
  PLAN("seguranca", "000-roles.sql"),
  P("sofia-demo", "sql", "schema-agendamentos-bella.sql"),
  P("sofia-demo", "sql", "DRAFT-prontuario-modelo.sql"),
];

let ignorados;
try {
  const { passos, ignorados: ig } = construirPassosDosModulos(PAINEL);
  BASE.push(...passos.map(([rel, base]) => path.join(base, rel)));
  ignorados = ig;
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
}

BASE.push(
  // A cauda de seguranca vai POR ULTIMO e na MESMA ORDEM de verify.mjs. Nao e
  // detalhe: 004 faz `GRANT SELECT, INSERT, UPDATE ON ALL TABLES TO app_painel`,
  // desfazendo o REVOKE das tabelas de regra feito em v2/007 e /008. Por isso
  // seguranca/007 vem depois de tudo. Montar o teste em outra ordem produz um
  // schema mais permissivo que o de producao — pior que nao testar.
  PLAN("seguranca", "004-auth-e-grants.sql"),
  PLAN("seguranca", "003-rate-limit.sql"),
  PLAN("seguranca", "005-titular.sql"),
  PLAN("seguranca", "001-lockdown.sql"),
  PLAN("seguranca", "007-fonte-da-verdade-somente-leitura.sql")
);

const CONTRACT_TESTS = [
  PLAN("camada-a", "sql", "005-contract-test.sql"),
  PLAN("camada-a-v2", "sql", "004-contract-test.sql"),
  // orfaos ate 2026-09-01: existiam no repo e nunca rodavam no CI.
  PLAN("bot-agendamento", "sql", "002-contract-test.sql"),
  PLAN("seguranca", "002-contract-test.sql"),
  PLAN("seguranca", "006-contract-test-titular.sql"),
  PLAN("camada-a-v2", "sql", "006-contract-test-tenant.sql"),
  PLAN("camada-a-v2", "sql", "009-contract-test-fonte-unica.sql"),
  // adicionados junto com os 4 módulos que passaram a montar (2026-09-01):
  // sem eles, crm/estoque/financeiro/prontuario montam schema mas nenhuma
  // asserção própria roda — mesmo defeito de "existe e nunca é chamado".
  PLAN("crm", "sql", "003-contract-test.sql"),
  PLAN("estoque", "sql", "003-contract-test.sql"),
  PLAN("financeiro", "sql", "003-contract-test.sql"),
  PLAN("prontuario", "sql", "002-contract-test-prontuario.sql"),
  // modulo `acesso` (2026-09-01, sessao par unify-chat-rbac-layer): 002 prova
  // que a matriz migrada e identica ao literal que estava em rbac-matriz.ts;
  // 003 prova que as tabelas de regra ficaram somente-leitura para app_painel
  // depois da cauda de seguranca -- e por isso tem de rodar DEPOIS dela.
  PLAN("acesso", "sql", "002-verify.sql"),
  PLAN("acesso", "sql", "003-contract-test.sql"),
  // freio de identidade WhatsApp (2026-09-01, `identidade.repo.ts`): prova a
  // tabela fechada, o EXECUTE liberado, o bloqueio em 3 falhas e a liberação
  // por sucesso — mesmo mecanismo de seguranca/002-contract-test.sql para login.
  PLAN("identidade", "sql", "002-contract-test.sql"),
];

const client = new pg.Client({ connectionString: URL });
await client.connect();
client.on("notice", (n) => {
  if (/^OK/.test(n.message)) console.log("   ", n.message);
});

let falhas = 0;

async function roda(sql, rotulo) {
  try {
    await client.query(sql);
    console.log("OK  ", rotulo);
  } catch (e) {
    falhas++;
    console.error("ERRO", rotulo, "\n    ", e.message);
    // ACHADO (2026-09-01, primeira execução de ponta a ponta deste runner):
    // sem ROLLBACK aqui, a conexão fica em transação abortada e TODO comando
    // seguinte falha com "current transaction is aborted" — uma falha real vira
    // N falhas fantasma que escondem qual foi a causa verdadeira. Cada arquivo
    // de contract-test abre BEGIN por conta própria (ver cabeçalho de cada um);
    // se ele morreu no meio, o ROLLBACK aqui é o que devolve a conexão a um
    // estado limpo para o próximo arquivo poder rodar de verdade.
    await client.query("ROLLBACK").catch(() => {});
    return false;
  }
  return true;
}

console.log("== schema base ==");
if (!(await roda(CLINICAS, "clinicas + seed"))) process.exit(1);
for (const f of BASE) {
  const ok = await roda(fs.readFileSync(f, "utf-8"), path.relative(RAIZ, f));
  if (!ok) {
    // Migração base que falha invalida tudo depois — parar aqui evita 12 erros
    // em cascata escondendo a causa real.
    console.error("\nschema base incompleto, abortando.");
    await client.end();
    process.exit(1);
  }
}

if (ignorados.length) {
  console.log(`\n${ignorados.length} .sql não são migração e não foram aplicados (rascunho/inspeção/cleanup):`);
  for (const f of ignorados) console.log("  ·", f);
}

// bot-agendamento/002-contract-test.sql (e potencialmente outros) esperam
// especificamente '[TESTE] Clinica A'/'[TESTE] Clinica B' POR NOME — o mesmo
// seed que verify.mjs cria depois do schema base, não as clínicas 1/2 que
// CLINICAS (acima) já semeia por id. São convenções diferentes coexistindo:
// alguns contract-tests olham `clinica_id = 2`, outros olham o nome. Sem este
// segundo seed, o primeiro tipo passa e o segundo falha com "seed ausente" —
// achado ao rodar este runner de ponta a ponta pela primeira vez em 2026-09-01.
console.log("\n== seed nomeado (p/ contract-tests que buscam por nome) ==");
const SEED_NOMEADO = `
INSERT INTO clinicas (nome) SELECT '[TESTE] Clinica A'
  WHERE NOT EXISTS (SELECT 1 FROM clinicas WHERE nome = '[TESTE] Clinica A');
INSERT INTO clinicas (nome) SELECT '[TESTE] Clinica B'
  WHERE NOT EXISTS (SELECT 1 FROM clinicas WHERE nome = '[TESTE] Clinica B');`;
if (!(await roda(SEED_NOMEADO, "seed [TESTE] Clinica A/B"))) process.exit(1);

// estoque/003-contract-test.sql declara no próprio cabeçalho "Pré-requisito:
// rodar seed-teste.sql antes" — mas seed-teste.sql cai em NAO_E_MIGRACAO
// (nome contém "seed"), então nunca era aplicado automaticamente. Achado no
// mesmo lote: sem isto, produto_id vem NULL e o INSERT em movimentacoes_estoque
// falha por NOT NULL — sintoma, não a causa (a causa é seed ausente).
if (
  !(await roda(
    fs.readFileSync(PLAN("estoque", "sql", "seed-teste.sql"), "utf-8"),
    "estoque/sql/seed-teste.sql (pré-requisito declarado do 003)"
  ))
) {
  process.exit(1);
}

console.log("\n== contract-tests ==");
for (const f of CONTRACT_TESTS) {
  await roda(fs.readFileSync(f, "utf-8"), path.relative(RAIZ, f));
}

await client.end();
console.log(falhas === 0 ? "\nTudo verde." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
