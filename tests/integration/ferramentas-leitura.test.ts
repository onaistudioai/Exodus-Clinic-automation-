import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";

/**
 * Parte C — ferramentas de leitura novas em chat-ferramentas.ts
 * (consultar_reativacao, consultar_escalonamento). Cada ferramenta nova
 * precisa do seu teste negativo (papel errado ⇒ vazio por policy) — mas
 * `ver_reativacao` e `ver_escalonamento` são concedidas aos TRÊS papéis
 * (recepcao/medico/admin, ver `papel_acao`), então não existe "papel errado"
 * entre eles. A negação que sobra — e que ainda vale provar por policy, não
 * por `requireAcao()` — é: sem papel nenhum (canal whatsapp, ou GUC ausente).
 *
 * Mesma arquitetura de rls-negativos.test.ts: uma transação como owner, SET
 * ROLE app_painel pra cada asserção, ROLLBACK no fim. Nenhum import de
 * rbac.ts/tenant.ts.
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
let clinicaA: number;
let campanhaId: number;
let escalonamentoId: number;
let pacienteRetorno: number;
let usuarioMedico: number;
let acessoId: number;

async function comoContexto(ctx: {
  clinica_id?: number;
  canal?: "painel" | "whatsapp";
  papel?: "medico" | "recepcao" | "admin";
}): Promise<void> {
  await db.query("SET ROLE app_painel");
  for (const guc of ["clinica_id", "canal", "papel", "usuario_id", "paciente_id"]) {
    await db.query(`RESET app.${guc}`).catch(() => {});
  }
  for (const [k, v] of Object.entries(ctx)) {
    if (v === undefined) continue;
    await db.query("SELECT set_config($1, $2, true)", [`app.${k}`, String(v)]);
  }
}

before(async () => {
  if (!PODE_RODAR) return;
  db = new pg.Client({ connectionString: OWNER_URL, ssl: { rejectUnauthorized: true } });
  await db.connect();
  await db.query("BEGIN");

  const c = await db.query<{ id: number }>(
    `INSERT INTO clinicas (nome) VALUES ('[TESTE C] Clinica') RETURNING id`
  );
  clinicaA = c.rows[0].id;

  const camp = await db.query<{ id: number }>(
    `INSERT INTO reativacao_campanhas (clinica_id, nome, janela_dias, passos, ativa)
     VALUES ($1, '[TESTE C] campanha', 30, '[]'::jsonb, true) RETURNING id`,
    [clinicaA]
  );
  campanhaId = camp.rows[0].id;

  const esc = await db.query<{ id: number }>(
    `INSERT INTO escalonamentos (clinica_id, chat_id, gatilho)
     VALUES ($1, '[TESTE C] chat', 'pediu_humano') RETURNING id`,
    [clinicaA]
  );
  escalonamentoId = esc.rows[0].id;

  // Prova que a fronteira do prontuário (acesso-012) continua valendo pro CRM:
  // v_prontuario_visivel precisa devolver o sinal de retorno_pendente pra
  // RECEPÇÃO, que não tem ler_texto_clinico e nunca é o profissional_id da
  // entrada — é exatamente o caso que quebrou antes da correção.
  const usrMed = await db.query<{ id: number }>(
    `INSERT INTO usuarios (clinica_id, nome, papel) VALUES ($1, 'medico', 'medico') RETURNING id`,
    [clinicaA]
  );
  usuarioMedico = usrMed.rows[0].id;
  const pac = await db.query<{ id: number }>(
    `INSERT INTO pacientes (clinica_id, nome_completo, data_nascimento)
     VALUES ($1, '[TESTE C] paciente com retorno', '1990-01-01') RETURNING id`,
    [clinicaA]
  );
  pacienteRetorno = pac.rows[0].id;
  await db.query(
    `INSERT INTO prontuario_entradas (clinica_id, paciente_id, profissional_id, precisa_retorno, texto_clinico)
     VALUES ($1, $2, $3, true, 'nota')`,
    [clinicaA, pacienteRetorno, usuarioMedico]
  );

  const acesso = await db.query<{ id: number }>(
    `INSERT INTO prontuario_acessos (clinica_id, usuario_id, paciente_id, acao)
     VALUES ($1, $2, $3, 'leu') RETURNING id`,
    [clinicaA, usuarioMedico, pacienteRetorno]
  );
  acessoId = acesso.rows[0].id;
});

after(async () => {
  if (!PODE_RODAR) return;
  await db.query("RESET ROLE");
  await db.query("ROLLBACK");
  await db.end();
});

test("consultar_reativacao: recepção (papel válido) lê a campanha", { skip: SKIP }, async () => {
  await comoContexto({ clinica_id: clinicaA, canal: "painel", papel: "recepcao" });
  const r = await db.query("SELECT * FROM reativacao_campanhas WHERE id = $1", [campanhaId]);
  assert.equal(r.rowCount, 1, "recepção tem ver_reativacao — deveria ver a campanha");
});

test("consultar_reativacao: sem papel (canal whatsapp) nega, mesmo a linha existindo", { skip: SKIP }, async () => {
  await comoContexto({ clinica_id: clinicaA, canal: "whatsapp" });
  const r = await db.query("SELECT * FROM reativacao_campanhas WHERE id = $1", [campanhaId]);
  assert.equal(r.rowCount, 0, "canal whatsapp não tem papel — nega por policy, não por a campanha não existir");
});

test("consultar_escalonamento: médico (papel válido) lê a fila", { skip: SKIP }, async () => {
  await comoContexto({ clinica_id: clinicaA, canal: "painel", papel: "medico" });
  const r = await db.query("SELECT * FROM escalonamentos WHERE id = $1", [escalonamentoId]);
  assert.equal(r.rowCount, 1, "médico tem ver_escalonamento — deveria ver o item");
});

test("consultar_escalonamento: sem papel (canal whatsapp) nega, mesmo a linha existindo", { skip: SKIP }, async () => {
  await comoContexto({ clinica_id: clinicaA, canal: "whatsapp" });
  const r = await db.query("SELECT * FROM escalonamentos WHERE id = $1", [escalonamentoId]);
  assert.equal(r.rowCount, 0, "canal whatsapp não tem papel — nega por policy, não por o item não existir");
});

// Fronteira do prontuário (acesso-012): consultar_crm depende de
// v_prontuario_visivel pra derivar retorno_pendente. Recepção não tem
// ler_texto_clinico e nunca é profissional_id de nenhuma entrada — antes da
// correção, isso zerava o sinal em silêncio pra ela. A view agora roda como
// dono (security_invoker=false) com filtro próprio de clinica_id/canal, não
// mais a policy de papel da tabela base.
test("consultar_crm: recepção enxerga retorno_pendente via v_prontuario_visivel (fronteira restaurada)", { skip: SKIP }, async () => {
  await comoContexto({ clinica_id: clinicaA, canal: "painel", papel: "recepcao" });
  const r = await db.query(
    "SELECT count(*) FROM v_prontuario_visivel WHERE paciente_id = $1 AND precisa_retorno = true",
    [pacienteRetorno]
  );
  assert.equal(r.rows[0].count, "1", "recepção deveria ver o metadado (não-clínico) de retorno pendente");
});

test("consultar_crm: canal whatsapp não enxerga nada em v_prontuario_visivel", { skip: SKIP }, async () => {
  await comoContexto({ clinica_id: clinicaA, canal: "whatsapp" });
  const r = await db.query(
    "SELECT count(*) FROM v_prontuario_visivel WHERE paciente_id = $1",
    [pacienteRetorno]
  );
  assert.equal(r.rows[0].count, "0", "a view é operacional do painel — canal whatsapp não tem o que fazer com metadado de prontuário");
});

// prontuario_acessos: ESTREITADA por acesso-013 (só tinha rls_tenant antes).
// Só admin tem ver_auditoria — a linha existe (seed no before()), então isto
// prova a policy, não tabela vazia por sorte.
test("consultar_auditoria: recepção (papel sem ver_auditoria) não lê a trilha", { skip: SKIP }, async () => {
  await comoContexto({ clinica_id: clinicaA, canal: "painel", papel: "recepcao" });
  const r = await db.query("SELECT * FROM prontuario_acessos WHERE id = $1", [acessoId]);
  assert.equal(r.rowCount, 0, "recepção não tem ver_auditoria — deveria negar");
});

test("consultar_auditoria: médico (papel sem ver_auditoria) não lê a trilha", { skip: SKIP }, async () => {
  await comoContexto({ clinica_id: clinicaA, canal: "painel", papel: "medico" });
  const r = await db.query("SELECT * FROM prontuario_acessos WHERE id = $1", [acessoId]);
  assert.equal(r.rowCount, 0, "médico não tem ver_auditoria — deveria negar");
});

test("consultar_auditoria: admin lê a trilha", { skip: SKIP }, async () => {
  await comoContexto({ clinica_id: clinicaA, canal: "painel", papel: "admin" });
  const r = await db.query("SELECT * FROM prontuario_acessos WHERE id = $1", [acessoId]);
  assert.equal(r.rowCount, 1, "admin tem ver_auditoria — deveria ver a linha");
});

// Parte F: chat_chamadas — mesma trava de ver_auditoria (é trilha de
// fiscalização, mesma classe de prontuario_acessos). Append-only por
// trigger: não seed via INSERT direto e depois DELETE — usa o próprio
// registrarChamada-equivalente (INSERT simples) e deixa a linha (a suíte já
// roda dentro de uma transação com ROLLBACK no after()).
test("chat_chamadas: recepção (sem ver_auditoria) não lê, admin lê", { skip: SKIP }, async () => {
  await db.query("RESET ROLE");
  const linha = await db.query<{ id: number }>(
    `INSERT INTO chat_chamadas (clinica_id, usuario_id, ferramenta, acao, resultado)
     VALUES ($1, $2, 'consultar_crm', 'ver_crm', 'sucesso') RETURNING id`,
    [clinicaA, usuarioMedico]
  );
  const chamadaId = linha.rows[0].id;

  await comoContexto({ clinica_id: clinicaA, canal: "painel", papel: "recepcao" });
  let r = await db.query("SELECT * FROM chat_chamadas WHERE id = $1", [chamadaId]);
  assert.equal(r.rowCount, 0, "recepção não tem ver_auditoria — deveria negar");

  await comoContexto({ clinica_id: clinicaA, canal: "painel", papel: "admin" });
  r = await db.query("SELECT * FROM chat_chamadas WHERE id = $1", [chamadaId]);
  assert.equal(r.rowCount, 1, "admin tem ver_auditoria — deveria ver a linha");
});
