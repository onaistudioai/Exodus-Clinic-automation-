// _negativo.mjs — prova que a bateria falha quando a guarda some.
// Derruba o trigger e o índice de idempotência dentro de uma transação,
// roda a bateria, e espera que ela QUEBRE. ROLLBACK no fim.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
const bateria = fs.readFileSync(path.join(AQUI, "sql/003-contract-test-bordas.sql"), "utf8")
  .replace(/^BEGIN;/m, "").replace(/^ROLLBACK;/m, "");

await c.connect();
for (const [nome, sabotagem] of [
  ["trigger de estado terminal", "DROP TRIGGER t_estado_agendamento ON agendamentos_sofia_demo"],
  ["índice de idempotência",     "DROP INDEX uq_evt_terminal"],
]) {
  await c.query("BEGIN");
  await c.query(sabotagem);
  try {
    await c.query(bateria);
    console.log(`❌ ${nome}: removido e a bateria AINDA PASSOU — teste vazio.`);
  } catch (e) {
    console.log(`✓ ${nome}: removido -> bateria falhou (${e.message.split("\n")[0].slice(0, 70)})`);
  }
  await c.query("ROLLBACK");
}
await c.end();
