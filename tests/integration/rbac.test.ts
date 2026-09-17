import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

import { ACOES, PAPEIS } from "../../src/lib/rbac-matriz.ts";

/**
 * A matriz de autorização é a decisão mais barata de testar e a mais cara de
 * errar. Cada asserção aqui é uma frase do contrato/LGPD, não uma preferência.
 *
 * POR QUE ESTE TESTE MUDOU DE CAMADA
 * Ele era um teste unitário puro, porque a política era um literal em
 * TypeScript. Agora a política é dado no banco (`papel_acao`), então um teste
 * que não fala com o banco não prova mais nada sobre a política real — provaria
 * apenas que uma cópia concorda consigo mesma. É a mesma fronteira que
 * schema-contract.test.ts cobre para os status: nem o `tsc` nem os contract-tests
 * SQL a enxergam sozinhos.
 */

let db: pg.Client;

before(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
});

after(async () => {
  await db.end();
});

async function pode(papel: string, acao: string): Promise<boolean> {
  const { rows } = await db.query(
    "SELECT 1 FROM papel_acao WHERE papel_chave = $1 AND acao_chave = $2",
    [papel, acao]
  );
  return rows.length > 0;
}

// --------------------------------------------------------------------------
// Fronteira TS <-> banco: o vocabulário não pode divergir da tabela.
// --------------------------------------------------------------------------

test("as ações do TypeScript e da tabela `acao` são as mesmas", async () => {
  const { rows } = await db.query<{ chave: string }>("SELECT chave FROM acao");
  const noBanco = new Set(rows.map((r) => r.chave));
  const noCodigo = new Set<string>(ACOES);

  const faltamNoBanco = [...noCodigo].filter((a) => !noBanco.has(a));
  const faltamNoCodigo = [...noBanco].filter((a) => !noCodigo.has(a));

  assert.deepEqual(faltamNoBanco, [], "ações no TS que não existem na tabela `acao`");
  assert.deepEqual(faltamNoCodigo, [], "ações na tabela que o TS desconhece");
});

test("os papéis do TypeScript e da tabela `papel` são os mesmos", async () => {
  const { rows } = await db.query<{ chave: string }>("SELECT chave FROM papel");
  assert.deepEqual([...rows.map((r) => r.chave)].sort(), [...PAPEIS].sort());
});

// --------------------------------------------------------------------------
// As frases do contrato. Mesmas asserções de antes, agora contra a fonte única.
// --------------------------------------------------------------------------

test("recepção NÃO lê texto clínico — decisão travada do DRAFT §0.4", async () => {
  assert.equal(await pode("recepcao", "ler_texto_clinico"), false);
  assert.equal(await pode("medico", "ler_texto_clinico"), true);
  assert.equal(await pode("admin", "ler_texto_clinico"), true);
});

test("só médico cria entrada de prontuário", async () => {
  assert.equal(await pode("medico", "criar_entrada_prontuario"), true);
  assert.equal(await pode("recepcao", "criar_entrada_prontuario"), false);
  assert.equal(await pode("admin", "criar_entrada_prontuario"), false);
});

test("auditoria e expurgo são exclusivos do admin", async () => {
  for (const acao of ["ver_auditoria", "expurgo_logico"]) {
    assert.equal(await pode("admin", acao), true);
    assert.equal(await pode("recepcao", acao), false);
    assert.equal(await pode("medico", acao), false);
  }
});

test("médico não gere estoque, financeiro nem agenda", async () => {
  for (const acao of ["gerir_estoque", "gerir_financeiro", "gerir_agenda"]) {
    assert.equal(await pode("medico", acao), false, `médico não deveria ${acao}`);
  }
});

test("fila de escalonamento é visível e atendível pelos três papéis", async () => {
  for (const papel of PAPEIS) {
    assert.equal(await pode(papel, "ver_escalonamento"), true);
    assert.equal(await pode(papel, "gerir_escalonamento"), true);
  }
});

test("só o admin aprova solicitação — senão a fila de aprovação é decorativa", async () => {
  assert.equal(await pode("admin", "aprovar_solicitacao"), true);
  assert.equal(await pode("recepcao", "aprovar_solicitacao"), false);
  assert.equal(await pode("medico", "aprovar_solicitacao"), false);
});

test("toda ação sensível tem pelo menos um papel que a executa", async () => {
  const { rows } = await db.query<{ chave: string }>(
    `SELECT a.chave FROM acao a
      WHERE a.sensivel
        AND NOT EXISTS (SELECT 1 FROM papel_acao pa WHERE pa.acao_chave = a.chave)`
  );
  assert.deepEqual(
    rows.map((r) => r.chave),
    [],
    "ação sensível sem executor: toda tentativa vira aprovação que ninguém pode dar"
  );
});
