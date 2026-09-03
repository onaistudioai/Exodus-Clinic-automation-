#!/usr/bin/env node
/**
 * Parte G (sofia-acesso) — injeta DATABASE_URL, CPF_PEPPER e
 * SOFIA_HMAC_SECRETS do cofre local antes de `node --test`. Sem segredo
 * no repo: lê D:\projetos\.credentials\exodus\*.env, nunca imprime valor.
 *
 * Uso: node scripts/test-env.mjs [-- args extras pro node --test]
 *   node scripts/test-env.mjs
 *   node scripts/test-env.mjs -- tests/integration/rls-negativos.test.ts
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const CRED = "D:/projetos/.credentials/exodus";

function ler(arquivo, chave) {
  try {
    const conteudo = fs.readFileSync(`${CRED}/${arquivo}`, "utf-8");
    const m = conteudo.match(new RegExp(`^\\s*${chave}\\s*=\\s*['"]?([^'"\\r\\n]+)`, "m"));
    return m?.[1]?.trim();
  } catch {
    return undefined;
  }
}

const DATABASE_URL = ler("postgres.env", "DATABASE_URL_PAINEL_BR");
const CPF_PEPPER = ler("painel.env", "CPF_PEPPER");
const SOFIA_HMAC_SECRETS = ler("painel.env", "SOFIA_HMAC_SECRETS");
// Camada 3 (RETOMADA.md §4) — trajetória com LLM: mesma chave que a SOFIA usa no n8n.
const GROQ_API_KEY = ler("groq.env", "GROQ_API_KEY");

const faltando = [
  !DATABASE_URL && "DATABASE_URL_PAINEL_BR (postgres.env)",
  !CPF_PEPPER && "CPF_PEPPER (painel.env)",
  !SOFIA_HMAC_SECRETS && "SOFIA_HMAC_SECRETS (painel.env)",
  !GROQ_API_KEY && "GROQ_API_KEY (groq.env)",
].filter(Boolean);
if (faltando.length) {
  console.error("test-env: faltando no cofre local:", faltando.join(", "));
  console.error("Testes que dependem disso serão pulados (mesma convenção de schema-contract.test.ts).");
}

const argsExtra = process.argv.slice(2).filter((a) => a !== "--");
const args = argsExtra.length ? argsExtra : ["--experimental-strip-types", "--test", "tests/**/*.test.ts"];

const r = spawnSync("node", args, {
  stdio: "inherit",
  shell: true, // glob "tests/**/*.test.ts" precisa de shell no Windows
  env: {
    ...process.env,
    ...(DATABASE_URL ? { DATABASE_URL } : {}),
    ...(CPF_PEPPER ? { CPF_PEPPER } : {}),
    ...(SOFIA_HMAC_SECRETS ? { SOFIA_HMAC_SECRETS } : {}),
    ...(GROQ_API_KEY ? { GROQ_API_KEY } : {}),
  },
});
process.exit(r.status ?? 1);
