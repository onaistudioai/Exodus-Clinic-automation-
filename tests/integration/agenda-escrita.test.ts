import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";

/**
 * Parte C — escrita da agenda. Gate do plano: anti-overbooking íntegro sob
 * CONCORRÊNCIA — duas reservas simultâneas no mesmo slot, uma tem que falhar
 * por constraint. Isso não se prova com duas chamadas em sequência (a
 * segunda já veria a primeira via SELECT e nunca testaria a corrida de
 * verdade) — precisa de duas transações ABERTAS ao mesmo tempo disputando o
 * mesmo slot, a segunda bloqueada na constraint GiST até a primeira decidir.
 *
 * Duas conexões reais como app_painel (não o truque SET ROLE de owner —
 * aqui o que importa é medir o comportamento do banco sob concorrência de
 * verdade, com o role de produção).
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
const APP_URL = lerCred("DATABASE_URL_PAINEL_BR");
const PODE_RODAR = Boolean(OWNER_URL && APP_URL);
const SKIP = !PODE_RODAR && "sem o cofre local";

let owner: pg.Client;
let clinicaA: number;
let usuarioAdmin: number;
let profissionalId: number;
let servicoId: number;
let pacienteId: number;

before(async () => {
  if (!PODE_RODAR) return;
  // COMMITADO de propósito (não BEGIN...ROLLBACK como os outros arquivos):
  // o teste abre DUAS conexões separadas (c1/c2) que precisam enxergar o
  // seed — dado não commitado é invisível fora da transação que o criou
  // (MVCC). Cleanup em after() vira DELETE explícito.
  owner = new pg.Client({ connectionString: OWNER_URL, ssl: { rejectUnauthorized: true } });
  await owner.connect();

  const cl = await owner.query<{ id: number }>(
    `INSERT INTO clinicas (nome) VALUES ('[TESTE agenda] Clinica') RETURNING id`
  );
  clinicaA = cl.rows[0].id;
  const usr = await owner.query<{ id: number }>(
    `INSERT INTO usuarios (clinica_id, nome, papel) VALUES ($1, 'admin', 'admin') RETURNING id`,
    [clinicaA]
  );
  usuarioAdmin = usr.rows[0].id;
  const prof = await owner.query<{ id: number }>(
    `INSERT INTO profissionais (clinica_id, nome) VALUES ($1, '[TESTE] dr.') RETURNING id`,
    [clinicaA]
  );
  profissionalId = prof.rows[0].id;
  const serv = await owner.query<{ id: number }>(
    `INSERT INTO servicos (clinica_id, nome, duracao_min) VALUES ($1, '[TESTE] consulta', 30) RETURNING id`,
    [clinicaA]
  );
  servicoId = serv.rows[0].id;
  const pac = await owner.query<{ id: number }>(
    `INSERT INTO pacientes (clinica_id, nome_completo, data_nascimento) VALUES ($1, '[TESTE] paciente', '1990-01-01') RETURNING id`,
    [clinicaA]
  );
  pacienteId = pac.rows[0].id;
});

after(async () => {
  if (!PODE_RODAR) return;
  await owner.query("DELETE FROM agendamentos_sofia_demo WHERE clinica_id = $1", [clinicaA]);
  await owner.query("DELETE FROM pacientes WHERE clinica_id = $1", [clinicaA]);
  await owner.query("DELETE FROM servicos WHERE clinica_id = $1", [clinicaA]);
  await owner.query("DELETE FROM profissionais WHERE clinica_id = $1", [clinicaA]);
  await owner.query("DELETE FROM usuarios WHERE clinica_id = $1", [clinicaA]);
  await owner.query("DELETE FROM clinicas WHERE id = $1", [clinicaA]);
  await owner.end();
});

async function comoAdmin(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: APP_URL, ssl: { rejectUnauthorized: true } });
  await c.connect();
  await c.query("BEGIN");
  await c.query("SELECT set_config('app.clinica_id', $1, true)", [String(clinicaA)]);
  await c.query("SELECT set_config('app.canal', 'painel', true)");
  await c.query("SELECT set_config('app.papel', 'admin', true)");
  await c.query("SELECT set_config('app.usuario_id', $1, true)", [String(usuarioAdmin)]);
  return c;
}

test("agenda: duas transações concorrentes no mesmo slot — uma falha por constraint", { skip: SKIP }, async () => {
  const inicio = "2027-03-01T10:00:00-03:00"; // data futura fixa, fora do alcance de qualquer job

  const c1 = await comoAdmin();
  const c2 = await comoAdmin();
  try {
    // c1 insere e NÃO comita ainda — segura o lock da constraint GiST.
    await c1.query(
      `INSERT INTO agendamentos_sofia_demo
         (clinica_id, paciente_id, profissional_id, servico_id, inicio, fim,
          data_agendamento, hora_agendamento, servico, profissional, status, telefone)
       VALUES ($1,$2,$3,$4,$5::timestamptz,$5::timestamptz + interval '30 min',
               ($5::timestamptz)::date, ($5::timestamptz)::time, 'x','y','confirmada','+5500000000000')`,
      [clinicaA, pacienteId, profissionalId, servicoId, inicio]
    );

    // c2 dispara o INSERT sobreposto SEM aguardar — deve bloquear no servidor,
    // esperando c1 decidir. Capturamos o desfecho (sucesso/erro) num objeto em
    // vez de guardar a Promise crua: se ela rejeitar ANTES de chegarmos ao
    // `assert.rejects` mais abaixo (o normal aqui — a rejeição acontece assim
    // que c1 comita, bem antes deste código retomar), o Node marca a rejeição
    // como "unhandled" e derruba o teste mesmo sendo tratada depois — achado
    // ao vivo (`unhandledRejection`/`PromiseRejectionHandledWarning`, teste
    // que ERA verde no primeiro run e vermelho no segundo). `.then()` com os
    // dois callbacks anexa o handler no mesmo tick da criação, sem essa
    // janela.
    let desfechoC2: { ok: true } | { ok: false; codigo: string | undefined } = {
      ok: false,
      codigo: "nunca_resolveu",
    };
    const promessaC2 = c2
      .query(
        `INSERT INTO agendamentos_sofia_demo
           (clinica_id, paciente_id, profissional_id, servico_id, inicio, fim,
            data_agendamento, hora_agendamento, servico, profissional, status, telefone)
         VALUES ($1,$2,$3,$4,$5::timestamptz,$5::timestamptz + interval '30 min',
                 ($5::timestamptz)::date, ($5::timestamptz)::time, 'x','y','confirmada','+5500000000001')`,
        [clinicaA, pacienteId, profissionalId, servicoId, inicio]
      )
      .then(
        () => { desfechoC2 = { ok: true }; },
        (err: unknown) => {
          desfechoC2 = { ok: false, codigo: err instanceof Error && "code" in err ? (err as { code?: string }).code : undefined };
        }
      );

    // Espera pra c2 realmente chegar a bloquear no servidor antes de
    // commitar c1 — sem isso o teste podia (raramente) commitar c1 antes de
    // c2 nem ter enviado a query, o que provaria menos.
    await new Promise((r) => setTimeout(r, 500));

    await c1.query("COMMIT");
    await promessaC2; // agora resolve/rejeita de verdade — já está tratada acima

    assert.equal(desfechoC2.ok, false, "a segunda transação concorrente deveria falhar, não silenciosamente suceder");
    if (!desfechoC2.ok) {
      assert.equal(desfechoC2.codigo, "23P01", "deveria ser exclusion_violation (no_overbooking), não outro erro");
    }
    await c2.query("ROLLBACK").catch(() => {});
  } finally {
    await c1.end();
    await c2.end();
  }
});

// ---------------------------------------------------------------------------
// Regressão da acesso-018. `agendamentos_sofia_demo` tinha UNIQUE (chat_id), e
// criarAgendamento preenche chat_id com o contato titular do paciente — então
// o SEGUNDO agendamento de qualquer paciente com WhatsApp vinculado falhava
// com 23505. Ficou invisível porque os fixtures deste arquivo criam paciente
// SEM contato: chat_id fica NULL, e UNIQUE aceita N nulos.
//
// Este teste força o caso real (mesmo chat_id, dois horários), e a asserção
// estrutural impede a constraint de voltar numa migration futura sem ninguém
// perceber.
// ---------------------------------------------------------------------------
test("agenda: o mesmo contato pode ter dois agendamentos (chat_id não é identidade)", { skip: SKIP }, async () => {
  const CHAT = "5511999990000@c.us";
  const criar = (inicio: string) =>
    owner.query<{ id: number }>(
      `INSERT INTO agendamentos_sofia_demo
              (clinica_id, paciente_id, profissional_id, servico_id, telefone, chat_id,
               data_agendamento, hora_agendamento, inicio, fim, status)
            VALUES ($1,$2,$3,$4,'11999990000',$5,
                    ($6::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date,
                    ($6::timestamptz AT TIME ZONE 'America/Sao_Paulo')::time,
                    $6::timestamptz, $6::timestamptz + interval '30 min', 'confirmada')
         RETURNING id`,
      [clinicaA, pacienteId, profissionalId, servicoId, CHAT, inicio]
    );

  const a = await criar("2027-04-01T10:00:00-03:00");
  const b = await criar("2027-04-08T10:00:00-03:00");
  assert.ok(a.rows[0]?.id, "primeiro agendamento deveria entrar");
  assert.ok(b.rows[0]?.id, "SEGUNDO agendamento do mesmo contato deveria entrar");

  const c = await owner.query(
    `SELECT 1 FROM pg_constraint
      WHERE conrelid = 'agendamentos_sofia_demo'::regclass
        AND contype = 'u' AND conname = 'agendamentos_sofia_demo_chat_id_key'`
  );
  assert.equal(c.rowCount, 0, "UNIQUE (chat_id) voltou — ver acesso-018");
});
