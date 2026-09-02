import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

import {
  resolverIdentidadeConfiavel,
  reconfirmarContato,
} from "../../src/server/identidade.repo.ts";

/**
 * Prova o freio de contato reciclado (W2e) na camada TS — a asserção que a
 * SQL sozinha não cobre: o retorno de `a_reconfirmar` não pode carregar nome
 * nem pacienteId. É a asserção que impede a regressão de vazamento.
 */

let db: pg.Client;
let clinicaId: number;

before(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO clinicas (nome) VALUES ('[TESTE] Reconfirmacao') RETURNING id`
  );
  clinicaId = rows[0].id;
  await db.query("SELECT set_config('app.clinica_id', $1, false)", [String(clinicaId)]);
});

after(async () => {
  await db.query("DELETE FROM clinicas WHERE id = $1", [clinicaId]);
  await db.end();
});

async function criarPacienteComContato(opts: {
  telefone: string;
  chatId: string;
  contatoStatus: string;
  verificadoEm: string | null; // expressão SQL, ex: "now()" ou "now() - interval '6 months'" ou null
}): Promise<void> {
  const { rows: pac } = await db.query<{ id: number }>(
    `INSERT INTO pacientes (clinica_id, nome_completo, data_nascimento)
     VALUES ($1, 'Fulano de Teste', '1990-01-01') RETURNING id`,
    [clinicaId]
  );
  const { rows: cont } = await db.query<{ id: number }>(
    `INSERT INTO contatos_whatsapp (clinica_id, chat_id, telefone, status, verificado_em)
     VALUES ($1, $2, $3, $4, ${opts.verificadoEm ?? "NULL"}) RETURNING id`,
    [clinicaId, opts.chatId, opts.telefone, opts.contatoStatus]
  );
  await db.query(
    `INSERT INTO paciente_contato (clinica_id, paciente_id, contato_id, titular)
     VALUES ($1, $2, $3, true)`,
    [clinicaId, pac[0].id, cont[0].id]
  );
}

beforeEach(async () => {
  await db.query("DELETE FROM paciente_contato WHERE clinica_id = $1", [clinicaId]);
  await db.query("DELETE FROM contatos_whatsapp WHERE clinica_id = $1", [clinicaId]);
  await db.query("DELETE FROM pacientes WHERE clinica_id = $1", [clinicaId]);
});

test("contato recém-verificado resolve normalmente", async () => {
  await criarPacienteComContato({
    telefone: "+5511911100001",
    chatId: "5511911100001@c.us",
    contatoStatus: "ativo",
    verificadoEm: "now()",
  });

  const r = await resolverIdentidadeConfiavel(db as never, "+5511911100001");
  assert.equal(r.tipo, "ok");
  if (r.tipo === "ok") {
    assert.equal(r.paciente.nome, "Fulano de Teste");
  }
});

test("verificado_em vencido (> 5 meses) vira a_reconfirmar, sem vazar nome/id", async () => {
  await criarPacienteComContato({
    telefone: "+5511911100002",
    chatId: "5511911100002@c.us",
    contatoStatus: "ativo",
    verificadoEm: "now() - interval '6 months'",
  });

  const r = await resolverIdentidadeConfiavel(db as never, "+5511911100002");
  assert.equal(r.tipo, "a_reconfirmar");
  if (r.tipo === "a_reconfirmar") {
    assert.equal(r.chatId, "5511911100002@c.us");
    assert.equal(r.clinicaId, clinicaId);
    // A asserção que impede a regressão de vazamento: o objeto inteiro não
    // pode ter nenhuma chave de nome/paciente.
    assert.deepEqual(Object.keys(r).sort(), ["chatId", "clinicaId", "tipo"]);
  }
});

test("verificado_em NULL (nunca verificado por humano) vira a_reconfirmar", async () => {
  await criarPacienteComContato({
    telefone: "+5511911100003",
    chatId: "5511911100003@c.us",
    contatoStatus: "ativo",
    verificadoEm: null,
  });

  const r = await resolverIdentidadeConfiavel(db as never, "+5511911100003");
  assert.equal(r.tipo, "a_reconfirmar");
});

test("status a_reconfirmar bloqueia mesmo com verificado_em recente", async () => {
  await criarPacienteComContato({
    telefone: "+5511911100004",
    chatId: "5511911100004@c.us",
    contatoStatus: "a_reconfirmar",
    verificadoEm: "now()",
  });

  const r = await resolverIdentidadeConfiavel(db as never, "+5511911100004");
  assert.equal(r.tipo, "a_reconfirmar");
});

test("carimbo da recepção (reconfirmarContato) devolve o contato a confiável", async () => {
  await criarPacienteComContato({
    telefone: "+5511911100005",
    chatId: "5511911100005@c.us",
    contatoStatus: "a_reconfirmar",
    verificadoEm: "now() - interval '1 year'",
  });

  const antes = await resolverIdentidadeConfiavel(db as never, "+5511911100005");
  assert.equal(antes.tipo, "a_reconfirmar");

  const ok = await reconfirmarContato(db as never, "5511911100005@c.us");
  assert.equal(ok, true);

  const depois = await resolverIdentidadeConfiavel(db as never, "+5511911100005");
  assert.equal(depois.tipo, "ok");
});

test("telefone desconhecido continua 'desconhecido', não 'a_reconfirmar'", async () => {
  const r = await resolverIdentidadeConfiavel(db as never, "+5511900000000");
  assert.equal(r.tipo, "desconhecido");
});
