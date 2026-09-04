import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";

import { lerCatalogoReal } from "../helpers/extrair-ferramentas.ts";

/**
 * Camada 2 (RETOMADA.md §4) — roteamento de autorização. Sem LLM, com banco.
 *
 * A matriz ferramenta × papel é DERIVADA de `papel_acao` em tempo de teste
 * (consultada ao vivo abaixo), nunca escrita à mão — o mapeamento
 * ferramenta -> acao vem do mesmo extrator AST da camada 1
 * (helpers/extrair-ferramentas.ts), não de uma segunda lista.
 *
 * REGRA (cobrada no GATE-REJEITADO da camada 1 e nos dois guardrails do
 * GATE-OK): a asserção tem que falhar pela POLICY, não pelo `requireAcao()`
 * — por isso nenhuma query aqui passa por rbac.ts/chat-ferramentas.ts.
 * Mesma arquitetura de rls-negativos.test.ts: uma transação como owner,
 * `SET ROLE app_painel` por asserção, GUCs via `set_config`, `ROLLBACK` no
 * fim.
 *
 * GUARDRAIL 1 (negação por policy ≠ negação por grant): `SELECT` negado por
 * RESTRICTIVE policy devolve zero linhas, nunca lança. Se uma query aqui
 * LANÇAR "permission denied for table", é GRANT faltando em `app_painel`
 * (a classe de bug provada pelas 4 falhas de identidade_tentativas — dívida
 * #8 do RETOMADA), não a policy negando — `classificarNegacao` distingue os
 * dois e falha alto se for grant, nunca deixa passar como se fosse RLS.
 *
 * GUARDRAIL 2 (controle positivo por célula): cada `PROBES[acao]` é testado
 * para OS TRÊS papéis, e a expectativa (visível vs. zero linhas) vem de uma
 * leitura ao vivo de `papel_acao` — nunca só o lado negativo. Uma policy que
 * negasse tudo, inclusive para quem deveria poder, quebraria o lado
 * positivo e o teste acusaria.
 *
 * GUARDRAIL 3 (sentinela estrutural — cobrado no GATE-OK condicional):
 * 6 das 10 acoes da matriz são concedidas aos TRÊS papéis, então não existe
 * papel negativo para elas hoje — a asserção 1/1/1 sozinha passaria idêntica
 * com a policy RESTRICTIVE removida da tabela. É o mesmo buraco achado em
 * `solicitacao_aprovacao` abaixo, generalizado: `assertPolicyRestritivaDePapel`
 * confirma, para cada probe, que a tabela TEM uma policy RESTRICTIVE
 * referenciando `papel_acao` para aquele comando — a estrutura, não o
 * resultado — para que remover a policy vire teste vermelho, não silêncio.
 *
 * O QUE ESTE ARQUIVO NÃO PROVA: a rota "vira pedido de aprovação" — isso é
 * decisão de `rbac-aprovacao.ts` (app layer, não RLS) baseada em
 * `acao.sensivel`; a tabela de destino (`solicitacao_aprovacao`) só tem
 * `rls_tenant`, sem policy de papel (confirmado ao vivo via pg_policies).
 * Isso não é uma lacuna de segurança neste caso: `ver_solicitacoes` é
 * concedida aos TRÊS papéis em produção (confirmado ao vivo), então não há
 * papel para o qual RLS precisaria negar hoje — ver os testes dedicados
 * abaixo. MAS é a única tabela do catálogo onde a autorização por papel
 * mora só em TypeScript — registrada como dívida #10 no RETOMADA §5
 * (parecer: deveria ganhar RESTRICTIVE por papel; decisão de DDL é do
 * usuário, não desta camada de teste).
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

type Papel = "recepcao" | "medico" | "admin";
const PAPEIS: Papel[] = ["recepcao", "medico", "admin"];

let db: pg.Client;
let clinica: number;
let usuario: number;
let paciente: number;
let seeds: Record<string, number> = {};

async function comoContexto(papel: Papel): Promise<void> {
  await db.query("SET ROLE app_painel");
  for (const guc of ["clinica_id", "canal", "papel", "usuario_id", "paciente_id"]) {
    await db.query(`RESET app.${guc}`).catch(() => {});
  }
  await db.query("SELECT set_config('app.clinica_id', $1, true)", [String(clinica)]);
  await db.query("SELECT set_config('app.canal', 'painel', true)");
  await db.query("SELECT set_config('app.papel', $1, true)", [papel]);
  await db.query("SELECT set_config('app.usuario_id', $1, true)", [String(usuario)]);
}

async function comoDono(): Promise<void> {
  await db.query("RESET ROLE");
}

/** Distingue negação por GRANT (bug) de negação por RLS (o que este arquivo prova). */
function classificarErro(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  if (/permission denied for table/i.test(msg)) {
    assert.fail(
      `negação por GRANT ausente na role app_painel, não por policy — não é o que este teste prova: ${msg}`
    );
  }
  throw e; // erro inesperado: não abafa, quebra o teste alto
}

async function selecionar(tabela: string, id: number): Promise<number> {
  try {
    const r = await db.query(`SELECT id FROM ${tabela} WHERE id = $1`, [id]);
    return r.rowCount ?? 0;
  } catch (e) {
    classificarErro(e);
  }
}

/** UPDATE sem efeito (coluna = ela mesma): ainda passa por USING/WITH CHECK, sem precisar reverter estado entre papéis. */
async function atualizarNoop(tabela: string, coluna: string, id: number): Promise<number> {
  try {
    const r = await db.query(`UPDATE ${tabela} SET ${coluna} = ${coluna} WHERE id = $1`, [id]);
    return r.rowCount ?? 0;
  } catch (e) {
    classificarErro(e);
  }
}

/**
 * Sentinela estrutural: 6 das 10 acoes da matriz são concedidas aos 3
 * papéis (nenhum negativo existe hoje), então a asserção 1/1/1 sozinha
 * passaria idêntica com a policy RESTRICTIVE removida da tabela — o mesmo
 * buraco achado em `solicitacao_aprovacao` (dívida #10). Sem essa checagem,
 * essas 6 linhas seriam decorativas. Prova que a tabela TEM uma policy
 * RESTRICTIVE de papel (`papel_acao` no qual/with_check) para o comando —
 * não seu resultado, só a estrutura — para uma policy removida virar teste
 * vermelho em vez de silêncio.
 */
async function assertPolicyRestritivaDePapel(tabela: string, cmd: "SELECT" | "UPDATE"): Promise<void> {
  await comoDono();
  const r = await db.query<{ qual: string | null; with_check: string | null }>(
    `SELECT qual, with_check FROM pg_policies
      WHERE schemaname = 'public' AND tablename = $1 AND cmd = $2 AND permissive = 'RESTRICTIVE'`,
    [tabela, cmd]
  );
  const temPapelAcao = r.rows.some((row) =>
    `${row.qual ?? ""} ${row.with_check ?? ""}`.includes("papel_acao")
  );
  assert.ok(
    temPapelAcao,
    `${tabela}: sem policy RESTRICTIVE de papel (papel_acao) para ${cmd} — esta linha da matriz passaria idêntica com a policy removida`
  );
}

async function papelTemAcao(papel: Papel, acao: string): Promise<boolean> {
  await comoDono();
  const r = await db.query("SELECT 1 FROM papel_acao WHERE papel_chave = $1 AND acao_chave = $2", [
    papel,
    acao,
  ]);
  return (r.rowCount ?? 0) > 0;
}

before(async () => {
  if (!PODE_RODAR) return;
  db = new pg.Client({ connectionString: OWNER_URL, ssl: { rejectUnauthorized: true } });
  await db.connect();
  await db.query("BEGIN");

  const c = await db.query<{ id: number }>(
    `INSERT INTO clinicas (nome) VALUES ('[TESTE E2] Clinica') RETURNING id`
  );
  clinica = c.rows[0].id;

  const u = await db.query<{ id: number }>(
    `INSERT INTO usuarios (clinica_id, nome, papel) VALUES ($1, 'seed', 'admin') RETURNING id`,
    [clinica]
  );
  usuario = u.rows[0].id;

  const p = await db.query<{ id: number }>(
    `INSERT INTO pacientes (clinica_id, nome_completo, data_nascimento)
     VALUES ($1, '[TESTE E2] paciente', '1990-01-01') RETURNING id`,
    [clinica]
  );
  paciente = p.rows[0].id;

  const produto = await db.query<{ id: number }>(
    `INSERT INTO produtos (clinica_id, nome) VALUES ($1, '[TESTE E2] produto') RETURNING id`,
    [clinica]
  );
  seeds.produtos = produto.rows[0].id;

  const lote = await db.query<{ id: number }>(
    `INSERT INTO lotes (clinica_id, produto_id, quantidade) VALUES ($1, $2, 10) RETURNING id`,
    [clinica, seeds.produtos]
  );
  seeds.lotes = lote.rows[0].id;

  const cobranca = await db.query<{ id: number }>(
    `INSERT INTO financeiro_cobrancas (clinica_id, paciente_id, valor) VALUES ($1, $2, 100) RETURNING id`,
    [clinica, paciente]
  );
  seeds.financeiro_cobrancas = cobranca.rows[0].id;

  const agendamento = await db.query<{ id: number }>(
    `INSERT INTO agendamentos_sofia_demo (clinica_id, paciente_id, telefone, data_agendamento, hora_agendamento)
     VALUES ($1, $2, '+5547990000001', CURRENT_DATE + 1, '11:00') RETURNING id`,
    [clinica, paciente]
  );
  seeds.agendamentos_sofia_demo = agendamento.rows[0].id;

  const tarefa = await db.query<{ id: number }>(
    `INSERT INTO crm_tarefas (clinica_id, paciente_id, titulo) VALUES ($1, $2, '[TESTE E2] tarefa') RETURNING id`,
    [clinica, paciente]
  );
  seeds.crm_tarefas = tarefa.rows[0].id;

  const campanha = await db.query<{ id: number }>(
    `INSERT INTO reativacao_campanhas (clinica_id, nome, janela_dias, passos, ativa)
     VALUES ($1, '[TESTE E2] campanha', 30, '[]'::jsonb, true) RETURNING id`,
    [clinica]
  );
  seeds.reativacao_campanhas = campanha.rows[0].id;

  const escalonamento = await db.query<{ id: number }>(
    `INSERT INTO escalonamentos (clinica_id, chat_id, gatilho) VALUES ($1, '[TESTE E2] chat', 'pediu_humano') RETURNING id`,
    [clinica]
  );
  seeds.escalonamentos = escalonamento.rows[0].id;

  const acesso = await db.query<{ id: number }>(
    `INSERT INTO prontuario_acessos (clinica_id, usuario_id, paciente_id, acao) VALUES ($1, $2, $3, 'leu') RETURNING id`,
    [clinica, usuario, paciente]
  );
  seeds.prontuario_acessos = acesso.rows[0].id;

  const solicitacao = await db.query<{ id: number }>(
    `INSERT INTO solicitacao_aprovacao (clinica_id, acao_chave, solicitante_id, argumentos)
     VALUES ($1, 'gerir_financeiro', $2, '{}'::jsonb) RETURNING id`,
    [clinica, usuario]
  );
  seeds.solicitacao_aprovacao = solicitacao.rows[0].id;
});

after(async () => {
  if (!PODE_RODAR) return;
  await db.query("RESET ROLE");
  await db.query("ROLLBACK");
  await db.end();
});

// ---------------------------------------------------------------------------
// A matriz: uma linha por acao usada pelo catálogo real do chat, com a
// tabela/tipo de probe que a policy correspondente protege (confirmado ao
// vivo via pg_policies antes de escrever este arquivo — ver mensagem do
// GATE-PEDIDO). `ver_solicitacoes` fica de fora — tratada no teste dedicado.
// ---------------------------------------------------------------------------
interface Probe {
  acao: string;
  tabela: string;
  tipo: "select" | "update";
  coluna?: string; // só para update noop
}

const PROBES: Probe[] = [
  { acao: "ver_estoque", tabela: "produtos", tipo: "select" },
  { acao: "gerir_estoque", tabela: "lotes", tipo: "update", coluna: "quantidade" },
  { acao: "ver_financeiro", tabela: "financeiro_cobrancas", tipo: "select" },
  { acao: "gerir_financeiro", tabela: "financeiro_cobrancas", tipo: "update", coluna: "valor" },
  { acao: "ver_agenda", tabela: "agendamentos_sofia_demo", tipo: "select" },
  { acao: "gerir_agenda", tabela: "agendamentos_sofia_demo", tipo: "update", coluna: "telefone" },
  { acao: "ver_crm", tabela: "crm_tarefas", tipo: "select" },
  { acao: "ver_reativacao", tabela: "reativacao_campanhas", tipo: "select" },
  { acao: "ver_escalonamento", tabela: "escalonamentos", tipo: "select" },
  { acao: "ver_auditoria", tabela: "prontuario_acessos", tipo: "select" },
];

test("cobertura: toda acao do catálogo real de ferramentas (exceto ver_solicitacoes) está na matriz de probes", { skip: SKIP }, () => {
  const { ferramentas } = lerCatalogoReal();
  const acoesDoCatalogo = new Set(ferramentas.map((f) => f.acao));
  const acoesNaMatriz = new Set([...PROBES.map((p) => p.acao), "ver_solicitacoes"]);
  const faltando = [...acoesDoCatalogo].filter((a) => a && !acoesNaMatriz.has(a));
  assert.deepEqual(faltando, [], `ferramenta nova usa acao sem probe na matriz: ${faltando.join(", ")}`);
});

for (const probe of PROBES) {
  test(
    `matriz: acao "${probe.acao}" (${probe.tabela}, ${probe.tipo}) — os 3 papéis batem com papel_acao ao vivo`,
    { skip: SKIP },
    async () => {
      await assertPolicyRestritivaDePapel(probe.tabela, probe.tipo === "select" ? "SELECT" : "UPDATE");

      for (const papel of PAPEIS) {
        const permitida = await papelTemAcao(papel, probe.acao);
        await comoContexto(papel);

        const visivel =
          probe.tipo === "select"
            ? await selecionar(probe.tabela, seeds[probe.tabela])
            : await atualizarNoop(probe.tabela, probe.coluna!, seeds[probe.tabela]);

        if (permitida) {
          assert.equal(
            visivel,
            1,
            `${papel} TEM "${probe.acao}" em papel_acao mas RLS negou ${probe.tipo} em ${probe.tabela} — controle positivo falhou`
          );
        } else {
          assert.equal(
            visivel,
            0,
            `${papel} NÃO TEM "${probe.acao}" em papel_acao mas RLS deixou passar o ${probe.tipo} em ${probe.tabela} — vazamento`
          );
        }
      }
    }
  );
}

// ---------------------------------------------------------------------------
// ver_solicitacoes: por que fica fora da matriz de RLS acima — as duas
// afirmações que sustentam a exclusão, verificadas ao vivo em vez de presumidas.
// ---------------------------------------------------------------------------
test(
  "ver_solicitacoes é concedida aos 3 papéis — não sobra papel para RLS negar nesta dimensão",
  { skip: SKIP },
  async () => {
    await comoDono();
    for (const papel of PAPEIS) {
      const r = await db.query(
        "SELECT 1 FROM papel_acao WHERE papel_chave = $1 AND acao_chave = 'ver_solicitacoes'",
        [papel]
      );
      assert.equal((r.rowCount ?? 0) > 0, true, `${papel} deveria ter ver_solicitacoes`);
    }
  }
);

test(
  "solicitacao_aprovacao tem policy RESTRICTIVE por papel para ver_solicitacoes (dívida #10 resolvida — acesso-015)",
  { skip: SKIP },
  async () => {
    await comoDono();
    const r = await db.query<{
      policyname: string;
      permissive: string;
      cmd: string;
      qual: string | null;
    }>(
      `SELECT policyname, permissive, cmd, qual FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'solicitacao_aprovacao'`
    );

    const policiasDePapel = r.rows.filter((row) => (row.qual ?? "").includes("papel_acao"));
    assert.equal(
      policiasDePapel.length,
      1,
      "esperava exatamente 1 policy referenciando papel_acao em solicitacao_aprovacao (acesso-015) — se sumiu, a dívida #10 voltou a ficar aberta"
    );

    const policy = policiasDePapel[0]!;
    assert.equal(policy.permissive, "RESTRICTIVE", "a policy de papel tem de ser RESTRICTIVE — PERMISSIVE só adiciona acesso, nunca estreita (RETOMADA §3, armadilha 1)");
    assert.equal(policy.cmd, "SELECT", "esta policy cobre só leitura — INSERT/UPDATE de solicitarAprovacaoPacientePg continuam sob rls_tenant, sem RESTRICTIVE nova");
    assert.ok(policy.qual?.includes("ver_solicitacoes"), `qual deveria checar a ação 'ver_solicitacoes' — veio: ${policy.qual}`);
  }
);
