import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

/**
 * Prova o freio de força bruta na confirmação de identidade
 * (.planning/identidade/sql/001-freio-identidade.sql) contra um banco real —
 * mesma fronteira que rbac.test.ts cobre para a matriz: a regra vive no banco,
 * então só um teste que fala com o banco prova a regra de verdade.
 */

let db: pg.Client;

before(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
});

after(async () => {
  await db.end();
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
  await db.query("DELETE FROM identidade_tentativas WHERE telefone IN ($1, $2)", [TEL_A, TEL_B]);
});

test("3 falhas seguidas bloqueiam", async () => {
  assert.equal(await registrar(TEL_A, false), 0);
  assert.equal(await registrar(TEL_A, false), 0);
  const espera = await registrar(TEL_A, false);
  assert.ok(espera > 0, "3ª falha deveria bloquear");
});

test("sucesso zera o histórico e libera", async () => {
  await registrar(TEL_A, false);
  await registrar(TEL_A, false);
  await registrar(TEL_A, false);
  assert.ok((await consultar(TEL_A)) > 0, "deveria estar bloqueado antes do sucesso");

  assert.equal(await registrar(TEL_A, true), 0);
  assert.equal(await consultar(TEL_A), 0, "sucesso deveria liberar imediatamente");
});

test("telefones diferentes não interferem um no outro", async () => {
  await registrar(TEL_A, false);
  await registrar(TEL_A, false);
  await registrar(TEL_A, false);

  assert.ok((await consultar(TEL_A)) > 0, "A deveria estar bloqueado");
  assert.equal(await consultar(TEL_B), 0, "B não deveria ser afetado pelas falhas de A");
});

test("consultar não conta como tentativa", async () => {
  await consultar(TEL_A);
  await consultar(TEL_A);
  await consultar(TEL_A);
  await consultar(TEL_A);
  assert.equal(await consultar(TEL_A), 0, "só consultar nunca deveria bloquear");
});
