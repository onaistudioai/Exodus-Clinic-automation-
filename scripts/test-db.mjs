/**
 * test:db — monta o schema do ZERO e roda todos os contract-tests SQL.
 *
 * POR QUE ISTO EXISTE: a camada de contrato do banco já era boa em estrutura
 * (cada arquivo abre transação, faz asserções com RAISE EXCEPTION e dá ROLLBACK,
 * que é o mesmo formato do pgTAP) e péssima em automação — rodava à mão, arquivo
 * por arquivo, contra um branch criado na hora. Por isso, na prática, não rodava.
 *
 * A ORDEM abaixo não é arbitrária: foi descoberta reconstruindo o schema num
 * Postgres vazio. Roles antes de qualquer GRANT; agendamentos antes do
 * prontuário (que faz ALTER nele); escalonamentos antes da camada-a-v2.
 *
 * Uso:  DATABASE_URL=postgres://... node scripts/test-db.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const URL = process.env.DATABASE_URL;
if (!URL) {
  console.error("DATABASE_URL ausente. Aponte para um banco DESCARTÁVEL — este script cria schema.");
  process.exit(1);
}

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const P = (...p) => path.join(RAIZ, ...p);
const PLAN = (...p) => P("aios-painel", ".planning", ...p);

// clinicas é a única coisa aproveitável de sql/schema-consultas.sql: o resto do
// arquivo tem uma tabela `pacientes` ANTIGA e incompatível com a do prontuário.
const CLINICAS = `
CREATE TABLE IF NOT EXISTS clinicas (
  id SERIAL PRIMARY KEY, nome TEXT NOT NULL, telefone TEXT, endereco TEXT,
  horario_func TEXT, convenios TEXT, criado_em TIMESTAMPTZ DEFAULT NOW());
INSERT INTO clinicas (id, nome) VALUES (1,'Clinica 1'),(2,'Clinica Bella')
  ON CONFLICT (id) DO NOTHING;
SELECT setval('clinicas_id_seq', 10, true);`;

const BASE = [
  PLAN("seguranca", "000-roles.sql"),
  P("sofia-demo", "sql", "schema-agendamentos-bella.sql"),
  P("sofia-demo", "sql", "DRAFT-prontuario-modelo.sql"),
  PLAN("agenda-turnos", "sql", "001-agenda-turnos.sql"),
  PLAN("reativacao", "sql", "001-reativacao.sql"),
  PLAN("reativacao", "sql", "004-consentimento.sql"),
  PLAN("reativacao", "sql", "007-escalonamentos.sql"),
  PLAN("bot-agendamento", "sql", "001-bot-agendamento.sql"),
  // 002 instala a maquina de transicoes (fn_transicao_valida + trigger). Omiti-la
  // aqui escondeu, ate 2026-09-01, que os estados novos da camada-a ficavam
  // inalcancaveis em producao. Base incompleta = teste que passa mentindo.
  PLAN("bot-agendamento", "sql", "002-reserva-expiracao.sql"),
  PLAN("camada-a", "sql", "001-catraca.sql"),
  PLAN("camada-a", "sql", "002-estados-e-payload.sql"),
  PLAN("camada-a", "sql", "003-lead.sql"),
  PLAN("camada-a", "sql", "004-telemetria.sql"),
  PLAN("camada-a-v2", "sql", "001-guardrail.sql"),
  PLAN("camada-a-v2", "sql", "002-destino-escalada.sql"),
  PLAN("camada-a-v2", "sql", "003-fila-reversa.sql"),
  // A pasta seguranca/ e o wrapper de tenant ficavam FORA da base: o CI montava
  // um schema sem as funcoes de seguranca e sem fn_por_clinica, entao os testes
  // que as cobrem nao tinham onde rodar. Mesma causa do comentario acima.
  PLAN("camada-a-v2", "sql", "005-tenant-de-job.sql"),
  // 007 e 008: fonte unica de estados e inventario de alcance. 008 depende de
  // fn_tenant_atual (005) e das funcoes de expurgo que ele converte p/ INVOKER.
  PLAN("camada-a-v2", "sql", "007-estados-fonte-unica.sql"),
  PLAN("camada-a-v2", "sql", "008-inventario-alcance.sql"),
  // A cauda de seguranca vai POR ULTIMO e na MESMA ORDEM de verify.mjs. Nao e
  // detalhe: 004 faz `GRANT SELECT, INSERT, UPDATE ON ALL TABLES TO app_painel`,
  // desfazendo o REVOKE das tabelas de regra feito em v2/007 e /008. Por isso
  // seguranca/007 vem depois de tudo. Montar o teste em outra ordem produz um
  // schema mais permissivo que o de producao — pior que nao testar.
  PLAN("seguranca", "004-auth-e-grants.sql"),
  PLAN("seguranca", "003-rate-limit.sql"),
  PLAN("seguranca", "005-titular.sql"),
  PLAN("seguranca", "001-lockdown.sql"),
  PLAN("seguranca", "007-fonte-da-verdade-somente-leitura.sql"),
];

const CONTRACT_TESTS = [
  PLAN("camada-a", "sql", "005-contract-test.sql"),
  PLAN("camada-a-v2", "sql", "004-contract-test.sql"),
  // orfaos ate 2026-09-01: existiam no repo e nunca rodavam no CI.
  PLAN("bot-agendamento", "sql", "002-contract-test.sql"),
  PLAN("seguranca", "002-contract-test.sql"),
  PLAN("seguranca", "006-contract-test-titular.sql"),
  PLAN("camada-a-v2", "sql", "006-contract-test-tenant.sql"),
  PLAN("camada-a-v2", "sql", "009-contract-test-fonte-unica.sql"),
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

console.log("\n== contract-tests ==");
for (const f of CONTRACT_TESTS) {
  await roda(fs.readFileSync(f, "utf-8"), path.relative(RAIZ, f));
}

await client.end();
console.log(falhas === 0 ? "\nTudo verde." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
