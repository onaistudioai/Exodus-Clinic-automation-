// run.mjs — aplica 001 e roda o contract-test 002 num branch descartável.
//   cd aios-painel && DATABASE_URL="..." node .planning/bot-agendamento/run.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) { console.error("Defina DATABASE_URL (branch descartável)."); process.exit(1); }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
client.on("notice", (n) => console.log(`  · ${n.message}`));

try {
  await client.connect();
  for (const f of ["sql/001-bot-agendamento.sql", "sql/002-reserva-expiracao.sql", "sql/002-contract-test.sql", "sql/003-contract-test-bordas.sql"]) {
    console.log(`\n→ ${path.basename(f)}`);
    await client.query(fs.readFileSync(path.join(AQUI, f), "utf8"));
    console.log(`  ✓ ok`);
  }
  console.log("\n✅ nenhuma asserção falhou.");
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
