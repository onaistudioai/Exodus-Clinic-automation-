// verify.mjs — aplica o schema completo e roda o contract-test de segurança.
//
//   cd aios-painel
//   DATABASE_URL="postgres://...:5432/db?sslmode=require" node .planning/seguranca/verify.mjs
//
// Usa o `pg` que o painel já tem — sem psql, sem Docker, sem dependência nova.
//
// ⚠️ Use um BRANCH DESCARTÁVEL do Neon, nunca o banco principal: o lockdown
// altera roles e privilégios, e o seed cria clínicas "[TESTE]".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../../..");
const PAINEL = path.resolve(AQUI, "../..");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Defina DATABASE_URL (branch descartável do Neon).");
  process.exit(1);
}

// Passos: [caminho, tolerante]. Tolerante = falha não interrompe (arquivo pode
// depender de objeto criado direto em produção, que é justamente o que estamos
// mapeando ao reconstruir do zero).
// `clinicas` inline em vez de aplicar sql/schema-consultas.sql inteiro.
//
// ACHADO: aquele arquivo é o schema da era demo e define `pacientes` com
// (nome, telefone) — incompatível com o schema atual do DRAFT, que usa
// (nome_completo, data_nascimento, cpf_hash) e é o que pacientes.repo.ts
// consome. Como ambos usam CREATE TABLE IF NOT EXISTS, aplicar os dois cria
// a versão velha e faz o resto do DRAFT quebrar em "column does not exist".
// Em produção isso nunca apareceu porque o banco evoluiu incrementalmente.
const PRELUDIO = `
CREATE TABLE IF NOT EXISTS clinicas (
  id            SERIAL PRIMARY KEY,
  nome          TEXT NOT NULL,
  telefone      TEXT,
  endereco      TEXT,
  horario_func  TEXT,
  convenios     TEXT,
  criado_em     TIMESTAMPTZ DEFAULT NOW()
);`;

const passos = [
  // roles ANTES do schema: todo 001-*.sql de modulo termina com GRANT TO app_painel.
  ['.planning/seguranca/000-roles.sql', false, PAINEL],
  // bella cria agendamentos_sofia_demo; f02 depois adiciona clinica_id nela.
  ["sofia-demo/sql/schema-agendamentos-bella.sql", true, RAIZ],
  ["sofia-demo/sql/migration-f02-multitenant.sql", true, RAIZ],
  ["sofia-demo/sql/DRAFT-prontuario-modelo.sql", false, RAIZ],
];

for (const dir of fs.readdirSync(path.join(PAINEL, ".planning"))) {
  const sqlDir = path.join(PAINEL, ".planning", dir, "sql");
  if (!fs.existsSync(sqlDir)) continue;
  for (const f of fs.readdirSync(sqlDir).filter((f) => /^001-/.test(f))) {
    passos.push([path.join(".planning", dir, "sql", f), true, PAINEL]);
  }
}

passos.push(
  [".planning/seguranca/004-auth-e-grants.sql", false, PAINEL],
  [".planning/seguranca/003-rate-limit.sql", false, PAINEL],
  [".planning/seguranca/001-lockdown.sql", false, PAINEL]
);

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: true },
});

// RAISE NOTICE/WARNING chegam como evento, não como resultado. Sem isto, as
// asserções do contract-test rodariam mudas.
client.on("notice", (n) => {
  const tag = n.severity === "WARNING" ? "  ⚠" : "  ·";
  console.log(`${tag} ${n.message}`);
});

const falhas = [];

async function aplicar([rel, tolerante, base]) {
  const abs = path.join(base, rel);
  const nome = path.basename(rel);
  if (!fs.existsSync(abs)) {
    console.log(`  ⚠ ausente: ${nome}`);
    return;
  }
  try {
    await client.query(fs.readFileSync(abs, "utf8"));
    console.log(`  ✓ ${nome}`);
  } catch (err) {
    if (tolerante) {
      console.log(`  ⚠ ${nome}: ${err.message.split("\n")[0]}`);
      falhas.push(`${nome}: ${err.message.split("\n")[0]}`);
      // Arquivo que abriu BEGIN e morreu no meio deixa a conexão em transação
      // abortada — todo comando seguinte falharia em cascata. Limpa antes de seguir.
      await client.query("ROLLBACK").catch(() => {});
    } else {
      console.error(`\n  ✗ ${nome} FALHOU\n    ${err.message}`);
      throw err;
    }
  }
}

try {
  await client.connect();
  console.log(`→ conectado\n`);

  console.log("→ schema + módulos + segurança");
  await client.query(PRELUDIO);
  console.log("  ✓ clinicas (inline)");
  for (const p of passos) await aplicar(p);

  console.log("\n→ seed (2 clínicas, para provar o cruzamento)");
  await client.query(`
    INSERT INTO clinicas (nome) SELECT '[TESTE] Clinica A'
      WHERE NOT EXISTS (SELECT 1 FROM clinicas WHERE nome = '[TESTE] Clinica A');
    INSERT INTO clinicas (nome) SELECT '[TESTE] Clinica B'
      WHERE NOT EXISTS (SELECT 1 FROM clinicas WHERE nome = '[TESTE] Clinica B');
  `);
  console.log("  ✓ ok");

  console.log("\n════════ CONTRACT-TEST DE SEGURANÇA ════════");
  await client.query(
    fs.readFileSync(path.join(PAINEL, ".planning/seguranca/002-contract-test.sql"), "utf8")
  );
  console.log("════════════════════════════════════════════");
  console.log("✅ nenhuma asserção falhou.");

  if (falhas.length) {
    console.log(`\n⚠️  ${falhas.length} arquivo(s) não aplicaram — lacunas do que nunca foi versionado:`);
    for (const f of falhas) console.log(`   - ${f}`);
  }
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
