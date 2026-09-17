import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";

/**
 * Prova o freio de força bruta na confirmação de identidade
 * (.planning/identidade/sql/001-freio-identidade.sql) contra um banco real —
 * mesma fronteira que rbac.test.ts cobre para a matriz: a regra vive no banco,
 * então só um teste que fala com o banco prova a regra de verdade.
 *
 * DUAS CONEXÕES DE PROPÓSITO (dívida #8 do RETOMADA, diagnóstico corrigido
 * 2026-09-02): `db` (app_painel) só chama `fn_identidade_freio*` — o caminho
 * real de produção (SECURITY DEFINER, dona neondb_owner, EXECUTE concedido a
 * app_painel). `identidade_tentativas` NÃO tem grant direto para app_painel,
 * e não deveria ter: dar SELECT/INSERT cru abriria o livro-caixa do próprio
 * freio de força bruta ao papel da aplicação, que é exatamente o que o
 * DEFINER existe para impedir. O `beforeEach` fazia `DELETE` cru na tabela
 * como `db` (app_painel) — daí o "permission denied for table" — então o
 * cleanup usa `owner` (neondb_owner via cofre), a única conexão com
 * privilégio de fato na tabela, igual às outras suites de integração.
 */

const CRED_PATH = "D:/projetos/.credentials/exodus/postgres.env";
function lerCred(chave: string): string | undefined {
  try {
    const env = fs.readFileSync(CRED_PATH, "utf-8");
    const m = env.match(new RegExp(`^\\s*${chave}\\s*=\\s*['"]?([^'"\\r\\n]+)`, "m"));
    return m?.[1]?.trim();
  } catch {
    return undefined;
  }
}
const OWNER_URL = lerCred("DATABASE_URL_OWNER_BR");
const PODE_RODAR = Boolean(process.env.DATABASE_URL && OWNER_URL);
const SKIP = !PODE_RODAR && "sem DATABASE_URL (app_painel) e/ou DATABASE_URL_OWNER_BR (cofre local)";

let db: pg.Client; // app_painel — só chama fn_identidade_freio*, o caminho real
let owner: pg.Client; // neondb_owner — só para o cleanup da tabela entre testes

before(async () => {
  if (!PODE_RODAR) return;
  db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  owner = new pg.Client({ connectionString: OWNER_URL, ssl: { rejectUnauthorized: true } });
  await owner.connect();
});

after(async () => {
  if (!PODE_RODAR) return;
  await db.end();
  await owner.end();
});

async function consultar(telefone: string): Promise<number> {
  const { rows } = await db.query<{ espera: number }>(
    "SELECT fn_identidade_freio_consultar($1) AS espera",
    [telefone]
  );
  return rows[0].espera;
}

async function registrar(telefone: string, sucesso: boolean): Promise<number> {
  const { rows } = await db.query<{ espera: number }>(
    "SELECT fn_identidade_freio($1, $2) AS espera",
    [telefone, sucesso]
  );
  return rows[0].espera;
}

const TEL_A = "+5511911111111-teste-node";
const TEL_B = "+5511922222222-teste-node";

beforeEach(async () => {
  if (!PODE_RODAR) return;
  // Como owner: app_painel não tem (e não deveria ter) grant direto na
  // tabela — só nas funções DEFINER acima.
  await owner.query("DELETE FROM identidade_tentativas WHERE telefone IN ($1, $2)", [TEL_A, TEL_B]);
});

test("3 falhas seguidas bloqueiam", { skip: SKIP }, async () => {
  assert.equal(await registrar(TEL_A, false), 0);
  assert.equal(await registrar(TEL_A, false), 0);
  const espera = await registrar(TEL_A, false);
  assert.ok(espera > 0, "3ª falha deveria bloquear");
});

test("sucesso zera o histórico e libera", { skip: SKIP }, async () => {
  await registrar(TEL_A, false);
  await registrar(TEL_A, false);
  await registrar(TEL_A, false);
  assert.ok((await consultar(TEL_A)) > 0, "deveria estar bloqueado antes do sucesso");

  assert.equal(await registrar(TEL_A, true), 0);
  assert.equal(await consultar(TEL_A), 0, "sucesso deveria liberar imediatamente");
});

test("telefones diferentes não interferem um no outro", { skip: SKIP }, async () => {
  await registrar(TEL_A, false);
  await registrar(TEL_A, false);
  await registrar(TEL_A, false);

  assert.ok((await consultar(TEL_A)) > 0, "A deveria estar bloqueado");
  assert.equal(await consultar(TEL_B), 0, "B não deveria ser afetado pelas falhas de A");
});

test("consultar não conta como tentativa", { skip: SKIP }, async () => {
  await consultar(TEL_A);
  await consultar(TEL_A);
  await consultar(TEL_A);
  await consultar(TEL_A);
  assert.equal(await consultar(TEL_A), 0, "só consultar nunca deveria bloquear");
});
