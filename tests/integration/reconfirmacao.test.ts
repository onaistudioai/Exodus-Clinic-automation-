import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";

import {
  resolverIdentidadeConfiavel,
  reconfirmarContato,
  mudarStatusDoPaciente,
} from "../../src/server/identidade.repo.ts";

/**
 * Prova o freio de contato reciclado (W2e) na camada TS — a asserção que a
 * SQL sozinha não cobre: o retorno de `a_reconfirmar` não pode carregar nome
 * nem pacienteId. É a asserção que impede a regressão de vazamento.
 *
 * REESCRITO 2026-09-03 (dívida #9b do RETOMADA). A versão anterior deste
 * arquivo NUNCA rodou contra o banco — morria na resolução do import
 * (`identidade.repo.ts` arrastava `@/server/solicitacao-paciente.repo`, que
 * `node --test` puro não resolve; conserto em `identidade.repo.ts`, ver o
 * comentário de `solicitarAprovacaoPacientePgLazy` lá). Rodando pela
 * primeira vez de verdade, apareceram dois problemas que a versão anterior
 * escondia havia meses:
 *
 *   1. `app_painel` não tem `DELETE` em NENHUMA tabela tocada aqui — mesma
 *      convenção do resto do schema (nunca teve, não é regressão de hoje).
 *      O `beforeEach`/`after` antigos faziam `DELETE` cru como `app_painel`
 *      e falhavam com "permission denied for table".
 *   2. Esse `DELETE` falhando no `after()` pulava a linha `db.end()`
 *      seguinte — a conexão pg ficava aberta, o event loop nunca esvaziava,
 *      e `node --test` NUNCA terminava sozinho. Travamento silencioso, sem
 *      nenhuma mensagem de erro visível (só apareceu forçando um `timeout`
 *      externo no processo).
 *
 * Correção: mesmo padrão de `rls-negativos.test.ts` — UMA transação como
 * `neondb_owner` (bypassa RLS pro seed), `ROLLBACK` no `after()` dentro de
 * um `finally` (TRAVA 1 do GATE-PEDIDO: a conexão fecha mesmo que o
 * `ROLLBACK` explodir — foi exatamente essa ausência que travou o processo
 * antes). Seed roda como owner; as chamadas reais a `identidade.repo.ts`
 * rodam sob `SET ROLE app_painel` — o caminho que a produção de fato usa,
 * não o bypass do owner.
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
const PODE_RODAR = Boolean(OWNER_URL);
const SKIP = !PODE_RODAR && "sem o cofre local (DATABASE_URL_OWNER_BR)";

let db: pg.Client;
let clinicaId: number;

before(async () => {
  if (!PODE_RODAR) return;
  db = new pg.Client({ connectionString: OWNER_URL, ssl: { rejectUnauthorized: true } });
  await db.connect();
  await db.query("BEGIN");

  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO clinicas (nome) VALUES ('[TESTE reconfirmacao] Clinica') RETURNING id`
  );
  clinicaId = rows[0].id;
  // is_local=false: vale pro resto da SESSÃO, não só a próxima query — sobrevive
  // ao SET ROLE (GUC não é afetado por troca de role) e não precisa ser
  // resetado entre testes, porque todos usam a mesma clínica.
  await db.query("SELECT set_config('app.clinica_id', $1, false)", [String(clinicaId)]);
});

after(async () => {
  if (!PODE_RODAR) return;
  try {
    await db.query("RESET ROLE");
    await db.query("ROLLBACK"); // desfaz TODO o seed — nenhum DELETE, nenhum resíduo
  } finally {
    // TRAVA 1 (GATE-PEDIDO): fecha mesmo que o ROLLBACK acima explodir. Foi a
    // ausência disto — um DELETE lançando antes de um `db.end()` alcançável —
    // que travou o processo inteiro por >90s sem mensagem.
    await db.end();
  }
});

async function comoOwner(): Promise<void> {
  await db.query("RESET ROLE");
}

async function comoAppPainel(): Promise<void> {
  await db.query("SET ROLE app_painel");
}

async function criarPacienteComContato(opts: {
  telefone: string;
  chatId: string;
  contatoStatus: string;
  verificadoEm: string | null; // expressão SQL, ex: "now()" ou "now() - interval '6 months'" ou null
}): Promise<void> {
  await comoOwner(); // seed sempre como dono — bypassa RLS, nunca precisa de grant extra
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

test("contato recém-verificado resolve normalmente", { skip: SKIP }, async () => {
  await criarPacienteComContato({
    telefone: "+5511911100001",
    chatId: "5511911100001@c.us",
    contatoStatus: "ativo",
    verificadoEm: "now()",
  });

  await comoAppPainel();
  const r = await resolverIdentidadeConfiavel(db as never, "+5511911100001");
  assert.equal(r.tipo, "ok");
  if (r.tipo === "ok") {
    assert.equal(r.paciente.nome, "Fulano de Teste");
  }
});

test("verificado_em vencido (> 5 meses) vira a_reconfirmar, sem vazar nome/id", { skip: SKIP }, async () => {
  await criarPacienteComContato({
    telefone: "+5511911100002",
    chatId: "5511911100002@c.us",
    contatoStatus: "ativo",
    verificadoEm: "now() - interval '6 months'",
  });

  await comoAppPainel();
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

test("verificado_em NULL (nunca verificado por humano) vira a_reconfirmar", { skip: SKIP }, async () => {
  await criarPacienteComContato({
    telefone: "+5511911100003",
    chatId: "5511911100003@c.us",
    contatoStatus: "ativo",
    verificadoEm: null,
  });

  await comoAppPainel();
  const r = await resolverIdentidadeConfiavel(db as never, "+5511911100003");
  assert.equal(r.tipo, "a_reconfirmar");
});

test("status a_reconfirmar bloqueia mesmo com verificado_em recente", { skip: SKIP }, async () => {
  await criarPacienteComContato({
    telefone: "+5511911100004",
    chatId: "5511911100004@c.us",
    contatoStatus: "a_reconfirmar",
    verificadoEm: "now()",
  });

  await comoAppPainel();
  const r = await resolverIdentidadeConfiavel(db as never, "+5511911100004");
  assert.equal(r.tipo, "a_reconfirmar");
});

test("carimbo da recepção (reconfirmarContato) devolve o contato a confiável", { skip: SKIP }, async () => {
  await criarPacienteComContato({
    telefone: "+5511911100005",
    chatId: "5511911100005@c.us",
    contatoStatus: "a_reconfirmar",
    verificadoEm: "now() - interval '1 year'",
  });

  await comoAppPainel();
  const antes = await resolverIdentidadeConfiavel(db as never, "+5511911100005");
  assert.equal(antes.tipo, "a_reconfirmar");

  const ok = await reconfirmarContato(db as never, "5511911100005@c.us");
  assert.equal(ok, true);

  const depois = await resolverIdentidadeConfiavel(db as never, "+5511911100005");
  assert.equal(depois.tipo, "ok");
});

test("telefone desconhecido continua 'desconhecido', não 'a_reconfirmar'", { skip: SKIP }, async () => {
  await comoAppPainel();
  const r = await resolverIdentidadeConfiavel(db as never, "+5511900000000");
  assert.equal(r.tipo, "desconhecido");
});

/**
 * Dívida #9b do RETOMADA: `mudarStatusDoPaciente`/`proximosAgendamentosDoPaciente`
 * usam `solicitarAprovacaoPacientePgLazy` (import dinâmico) como DEFAULT do
 * parâmetro `solicitar` — a correção que tirou `@/server/solicitacao-paciente.repo`
 * do grafo ESTÁTICO de `identidade.repo.ts`, pra este arquivo poder ser
 * importado por `node --test`. Este teste chama SEM passar `solicitar`,
 * provando que a assinatura com o default continua funcionando.
 *
 * TRAVA 2 do GATE-PEDIDO pedia ir além — um caso que chega em
 * `solicitar.abrir()` de verdade (vínculo existe, nível insuficiente).
 * Tentei: **é estruturalmente impossível sob `node --test` puro, não é uma
 * questão de import preguiçoso ou não.** Confirmado ao vivo antes de
 * escrever isto —
 *   `node -e "import('./src/server/solicitacao-paciente.repo.ts')..."`
 *   → `Cannot find package 'server-only'`
 * — ou seja, mesmo com o `import()` dinâmico resolvendo o CAMINHO (relativo,
 * sem alias), o MÓDULO importado abre com `import "server-only"` e depois
 * `@/lib/tenant` -> `@/lib/dal` -> `next/navigation`: a mesma cadeia que
 * bloqueou `chat-ferramentas.ts` na camada 1 (RETOMADA §4) — `cookies()`/
 * `headers()` do Next exigem um request real, que só existe dentro do
 * bundler do Next. Import dinâmico adia QUANDO a resolução acontece, não
 * SE ela precisa do runtime do Next — e ela precisa.
 *
 * Verificação que SUBSTITUI a trava 2 dentro do que é possível: `npm run
 * build` compila e empacota `identidade.repo.ts` -> `solicitacao-paciente.repo.ts`
 * -> `@/lib/tenant` sem erro (saída colada no GATE-PEDIDO) — é a única prova
 * honesta de que o caminho `.abrir()` funciona, porque é o único runtime
 * onde ele de fato roda. O cenário aqui embaixo ("sem vínculo titular")
 * prova a ASSINATURA do default, não a importação em si.
 */
test("mudarStatusDoPaciente sem vínculo titular devolve false com o `solicitar` padrão (sem injeção)", { skip: SKIP }, async () => {
  await comoOwner();
  const { rows: pac } = await db.query<{ id: number }>(
    `INSERT INTO pacientes (clinica_id, nome_completo, data_nascimento)
     VALUES ($1, 'Sem Vinculo', '1990-01-01') RETURNING id`,
    [clinicaId]
  );

  await comoAppPainel();
  const ok = await mudarStatusDoPaciente(db as never, pac[0].id, 999999, "cancelada");
  assert.equal(ok, false, "sem vínculo titular, deveria negar antes de tentar o UPDATE");
});
