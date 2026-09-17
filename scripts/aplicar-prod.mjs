// aplicar-prod.mjs — aplica o schema em um banco REAL (produção).
//
//   cd aios-painel
//   DATABASE_URL="postgres://..." node scripts/aplicar-prod.mjs
//
// POR QUE ESTE ARQUIVO EXISTE, se já há dois runners:
//
//   .planning/seguranca/verify.mjs  -> instalador + contract-tests, e o próprio
//       cabeçalho dele avisa: "use um BRANCH DESCARTÁVEL, nunca o banco
//       principal". Ele roda o seed que cria clínicas '[TESTE]' e as asserções
//       que criam dado sintético. Em produção isso é poluição, não verificação
//       — as clínicas '[TESTE]' que hoje sujam o exodus-br vieram exatamente
//       daí.
//   scripts/test-db.mjs             -> monta do zero e roda tudo. CI, não prod.
//
// Faltava o terceiro caso: aplicar as MIGRAÇÕES, e só elas, num banco que tem
// dado de gente. É este arquivo.
//
// A ORDEM NÃO É ESCRITA AQUI. Ela vem de .planning/seguranca/schema-modulos.mjs,
// a mesma fonte única que os outros dois consomem. Uma terceira lista escrita à
// mão seria o defeito que aquele arquivo existe para eliminar — e o pior tipo,
// porque a que roda em produção é a que ninguém testa.
//
// O que este script NÃO faz, de propósito: seed, contract-test, e qualquer
// escrita de dado. Só DDL/DML de migração.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { construirPassosDosModulos } from "../.planning/seguranca/schema-modulos.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PAINEL = path.resolve(AQUI, "..");
const RAIZ = path.resolve(PAINEL, "..");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Defina DATABASE_URL.");
  process.exit(1);
}

// Mesma sequência de `passos` do verify.mjs — ver os comentários de lá para o
// motivo de cada posição. A cauda de seguranca/ termina em 007 porque o 004
// faz GRANT ON ALL TABLES e reabre o que as tabelas de regra revogaram.
const passos = [
  [".planning/seguranca/000-roles.sql", PAINEL],
  ["sofia-demo/sql/schema-agendamentos-bella.sql", RAIZ],
  ["sofia-demo/sql/migration-f02-multitenant.sql", RAIZ],
  ["sofia-demo/sql/DRAFT-prontuario-modelo.sql", RAIZ],
];

let ignorados;
try {
  const r = construirPassosDosModulos(PAINEL);
  passos.push(...r.passos);
  ignorados = r.ignorados;
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
}

passos.push(
  [".planning/seguranca/004-auth-e-grants.sql", PAINEL],
  [".planning/seguranca/003-rate-limit.sql", PAINEL],
  [".planning/seguranca/005-titular.sql", PAINEL],
  [".planning/seguranca/001-lockdown.sql", PAINEL],
  [".planning/seguranca/007-fonte-da-verdade-somente-leitura.sql", PAINEL]
);

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: true },
});

client.on("notice", (n) => {
  if (n.severity === "WARNING") console.log(`   ⚠ ${n.message}`);
});

await client.connect();

console.log(`\nAplicando ${passos.length} migrações.\n`);

let falhou = null;
let aplicadas = 0;

for (const [rel, base] of passos) {
  const abs = path.join(base, rel);
  if (!fs.existsSync(abs)) {
    console.log(`· ${rel} — ausente no repo, pulado`);
    continue;
  }
  process.stdout.write(`→ ${rel} ... `);
  try {
    await client.query(fs.readFileSync(abs, "utf-8"));
    console.log("ok");
    aplicadas++;
  } catch (err) {
    console.log("FALHOU");
    console.log(`   ${err.message}`);
    // Para na primeira falha: seguir aplicaria migração sobre schema
    // meio-montado, que é como se produz um estado que ninguém sabe descrever.
    falhou = rel;
    break;
  }
}

await client.end();

if (ignorados?.length) {
  console.log(`\n(${ignorados.length} .sql ignorados por não serem migração)`);
}

console.log(
  falhou
    ? `\n=== INTERROMPIDO em ${falhou} — ${aplicadas} aplicadas antes ===`
    : `\n=== OK — ${aplicadas} migrações aplicadas ===`
);
process.exit(falhou ? 1 : 0);
