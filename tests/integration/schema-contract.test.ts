import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

import { STATUS_AGENDAMENTO } from "../../src/lib/status-agendamento.ts";
import { INTENCOES } from "../../src/lib/intencao.ts";

/**
 * CAMADA DE INTEGRAÇÃO — o contrato entre o TypeScript e o schema do banco.
 *
 * É a camada que a literatura descreve como a que pega "API contract mismatches",
 * e é exatamente o que faltava aqui: a união de status no TS ficou defasada do
 * CHECK do banco por duas migrações inteiras, e nem o `tsc` nem os contract-tests
 * SQL enxergam essa fronteira — um não conhece o banco, o outro não conhece o TS.
 *
 * Pula sem DATABASE_URL, para `npm test` continuar rápido e offline.
 */

const URL = process.env.DATABASE_URL;
let client: pg.Client;

before(async () => {
  if (!URL) return;
  client = new pg.Client({ connectionString: URL });
  await client.connect();
});

after(async () => {
  if (client) await client.end();
});

/**
 * Dívida #9 do RETOMADA: `chk_status_agendamento` não existe mais — o status
 * virou FK (`fk_status_agendamento REFERENCES estado_agendamento(estado)`),
 * então os valores válidos vivem como LINHAS de `estado_agendamento`, não
 * como literais dentro da definição da constraint. Confere que a FK aponta
 * pra tabela certa (guarda contra outra migração trocar o mecanismo de novo
 * em silêncio) e lê os valores de lá.
 */
async function valoresDaFk(constraint: string, tabelaEsperada: string, coluna: string): Promise<string[]> {
  const def = await client.query<{ def: string }>(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1`,
    [constraint]
  );
  assert.equal(def.rows.length, 1, `constraint ${constraint} não encontrada no banco`);
  assert.match(
    def.rows[0].def,
    new RegExp(`REFERENCES ${tabelaEsperada}\\(${coluna}\\)`),
    `${constraint} não referencia ${tabelaEsperada}(${coluna}) — mecanismo mudou de novo, atualize este teste`
  );

  const { rows } = await client.query<{ v: string }>(`SELECT ${coluna} AS v FROM ${tabelaEsperada}`);
  return rows.map((r) => r.v);
}

test("status do TS == valores de estado_agendamento (via fk_status_agendamento)", { skip: !URL && "sem DATABASE_URL" }, async () => {
  const noBanco = await valoresDaFk("fk_status_agendamento", "estado_agendamento", "estado");
  assert.deepEqual(
    [...STATUS_AGENDAMENTO].sort(),
    [...noBanco].sort(),
    "STATUS_AGENDAMENTO divergiu de estado_agendamento — atualize os dois lados"
  );
});

test("taxonomia de intenção do TS == enum do banco", { skip: !URL && "sem DATABASE_URL" }, async () => {
  const { rows } = await client.query<{ v: string }>(
    `SELECT unnest(enum_range(NULL::intencao_msg))::text AS v`
  );
  assert.deepEqual(
    [...INTENCOES].sort(),
    rows.map((r) => r.v).sort(),
    "INTENCOES divergiu do enum intencao_msg"
  );
});

test("o contrato de payload não vazou campo clínico", { skip: !URL && "sem DATABASE_URL" }, async () => {
  // Redundante com o contract-test SQL de propósito: esta é a garantia que, se
  // quebrar, manda dado de saúde para o WhatsApp. Vale ter dois olhos nela.
  for (const fn of ["fn_payload_lembrete", "fn_payload_oferta"]) {
    const { rows } = await client.query<{ src: string }>(
      `SELECT prosrc AS src FROM pg_proc WHERE proname = $1`,
      [fn]
    );
    assert.equal(rows.length, 1, `${fn} não existe no banco`);
    for (const proibido of ["procedimento", "gravidade", "diagnostico"]) {
      assert.ok(
        !new RegExp(`'${proibido}'`).test(rows[0].src),
        `${fn} monta a chave "${proibido}" no payload`
      );
    }
  }
});
