// verify.mjs — aplica o schema completo e roda o contract-test de segurança.
//
//   cd aios-painel
//   DATABASE_URL="postgres://...:5432/db?sslmode=require" node .planning/seguranca/verify.mjs
//
// Usa o `pg` que o painel já tem — sem psql, sem Docker, sem dependência nova.
//
// ⚠️ Use um BRANCH DESCARTÁVEL do Neon, nunca o banco principal: o lockdown
// altera roles e privilégios, e o seed cria clínicas "[TESTE]".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../../..");
const PAINEL = path.resolve(AQUI, "../..");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Defina DATABASE_URL (branch descartável do Neon).");
  process.exit(1);
}

// Passos: [caminho, tolerante]. Tolerante = falha não interrompe (arquivo pode
// depender de objeto criado direto em produção, que é justamente o que estamos
// mapeando ao reconstruir do zero).
// `clinicas` inline em vez de aplicar sql/schema-consultas.sql inteiro.
//
// ACHADO: aquele arquivo é o schema da era demo e define `pacientes` com
// (nome, telefone) — incompatível com o schema atual do DRAFT, que usa
// (nome_completo, data_nascimento, cpf_hash) e é o que pacientes.repo.ts
// consome. Como ambos usam CREATE TABLE IF NOT EXISTS, aplicar os dois cria
// a versão velha e faz o resto do DRAFT quebrar em "column does not exist".
// Em produção isso nunca apareceu porque o banco evoluiu incrementalmente.
const PRELUDIO = `
CREATE TABLE IF NOT EXISTS clinicas (
  id            SERIAL PRIMARY KEY,
  nome          TEXT NOT NULL,
  telefone      TEXT,
  endereco      TEXT,
  horario_func  TEXT,
  convenios     TEXT,
  criado_em     TIMESTAMPTZ DEFAULT NOW()
);`;

const passos = [
  // roles ANTES do schema: todo 001-*.sql de modulo termina com GRANT TO app_painel.
  ['.planning/seguranca/000-roles.sql', false, PAINEL],
  // bella cria agendamentos_sofia_demo; f02 depois adiciona clinica_id nela.
  ["sofia-demo/sql/schema-agendamentos-bella.sql", true, RAIZ],
  ["sofia-demo/sql/migration-f02-multitenant.sql", true, RAIZ],
  ["sofia-demo/sql/DRAFT-prontuario-modelo.sql", false, RAIZ],
];

// TODAS as migrações numeradas de cada módulo, em ordem numérica — não só as 001.
//
// ACHADO (2026-08-06): filtrar por /^001-/ deixava de fora
// `reativacao/004-consentimento.sql` (que cria registrar_consentimento,
// consentimento_eventos e a coluna marketing_optin), `007-escalonamentos.sql` e
// `estoque/004-falhas-fixes.sql`. O banco resultante subia "verde" e só quebrava
// em uso: fn_titular_eliminar chama registrar_consentimento, e a página de
// conformidade declarava metade das seções como não migradas.
//
// O que NÃO é migração e por isso fica de fora:
//   contract-test / prove / verify -> asserção, roda depois e cria dado de teste
//   seed                           -> dado de exemplo com clinica_id fixo
//   preflight                      -> checagem read-only de pré-requisito
const NAO_E_MIGRACAO = /contract-test|prove|verify|seed|preflight/;

// ORDEM EXPLÍCITA DOS MÓDULOS.
//
// ACHADO (2026-09-01): a ordem era a do `readdir`, isto é, alfabética por acaso.
// `reativacao` caía por último, mas `reativacao/004-consentimento` cria
// `marketing_optin` e `007-escalonamentos` cria a tabela `escalonamentos` — dos
// quais `camada-a/003-lead` e `camada-a-v2/001-guardrail`/`002-destino-escalada`
// dependem. Numa instalação NOVA, quatro migrações falhavam e o runner terminava
// com exit 0. Na SEGUNDA execução elas passavam, porque as dependências já
// existiam: um instalador que só produz schema completo se rodar duas vezes.
//
// Por isso a ordem é declarada, e não parcial: declarar metade e deixar metade
// alfabética recria o mesmo acidente na fronteira entre as duas.
const ORDEM_MODULOS = [
  "agenda-turnos",   // só depende do prelúdio
  "reativacao",      // ANTES de camada-a: cria marketing_optin (004) e escalonamentos (007)
  "bot-agendamento", // cria eventos_agendamento e notificacoes_saida, que camada-a altera
  "camada-a",        // 003-lead precisa de marketing_optin; 004-telemetria precisa de origem (003)
  "camada-a-v2",     // guardrail e destino-escalada precisam de escalonamentos
  "crm",
  "estoque",
  "financeiro",
  "prontuario",
];

const modulosComSql = fs
  .readdirSync(path.join(PAINEL, ".planning"))
  .filter((d) => fs.existsSync(path.join(PAINEL, ".planning", d, "sql")));

// Módulo novo tem de declarar sua posição. Sem isto, o próximo módulo criado
// voltaria a entrar na ordem alfabética em silêncio — o defeito de novo.
const semPosicao = modulosComSql.filter((d) => !ORDEM_MODULOS.includes(d));
if (semPosicao.length) {
  console.error(
    `\n❌ módulo(s) sem posição declarada em ORDEM_MODULOS: ${semPosicao.join(", ")}` +
      `\n   Acrescente cada um na posição correta e diga de que ele depende.`
  );
  process.exit(1);
}

const ignorados = [];
const malNumerados = [];

for (const dir of ORDEM_MODULOS) {
  if (!modulosComSql.includes(dir)) continue;
  const sqlDir = path.join(PAINEL, ".planning", dir, "sql");
  const todos = fs.readdirSync(sqlDir).filter((f) => f.endsWith(".sql"));
  const migracoes = todos
    .filter((f) => /^\d{3}-.*\.sql$/.test(f) && !NAO_E_MIGRACAO.test(f))
    .sort(); // intra-módulo o prefixo NNN- É a declaração de ordem
  for (const f of migracoes) {
    passos.push([path.join(".planning", dir, "sql", f), false, PAINEL]);
  }
  // Terceiro furo da mesma família: arquivo que EXISTE no disco e nunca é
  // aplicado nem mencionado. O runner não distinguia "não é migração" de
  // "deveria ser e ninguém percebeu". Agora todo .sql é classificado.
  for (const f of todos) {
    if (migracoes.includes(f) || NAO_E_MIGRACAO.test(f)) continue;
    // `01-foo.sql` ou `1-foo.sql`: parece migração e nunca rodaria, porque o
    // filtro exige três dígitos. É erro de numeração, não rascunho.
    if (/^\d{1,2}-/.test(f)) malNumerados.push(`${dir}/sql/${f}`);
    else ignorados.push(`${dir}/sql/${f}`);
  }
}

if (malNumerados.length) {
  console.error(
    `\n❌ arquivo(s) com numeração inválida — parecem migração e nunca rodariam:` +
      malNumerados.map((f) => `\n   - ${f}`).join("") +
      `\n   O prefixo tem de ter três dígitos (001-, 002-, ...).`
  );
  process.exit(1);
}

passos.push(
  [".planning/seguranca/004-auth-e-grants.sql", false, PAINEL],
  [".planning/seguranca/003-rate-limit.sql", false, PAINEL],
  // 005 depende de registrar_consentimento (reativacao/004). INTOLERANTE de
  // propósito: se aquela migração não aplicou, um banco sem os direitos do
  // titular tem de fazer barulho aqui, não descobrir no primeiro pedido real.
  [".planning/seguranca/005-titular.sql", false, PAINEL],
  [".planning/seguranca/001-lockdown.sql", false, PAINEL],
  // POR ÚLTIMO, e o "último" é o ponto: 004 acima faz
  // `GRANT SELECT, INSERT, UPDATE ON ALL TABLES ... TO app_painel`, o que desfaz
  // o REVOKE que camada-a-v2/007 e /008 aplicam nas tabelas de regra. Sem esta
  // linha, o deploy real reabre a escalada de privilégio que o teste não vê.
  [".planning/seguranca/007-fonte-da-verdade-somente-leitura.sql", false, PAINEL]
);

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: true },
});

// RAISE NOTICE/WARNING chegam como evento, não como resultado. Sem isto, as
// asserções do contract-test rodariam mudas.
client.on("notice", (n) => {
  const tag = n.severity === "WARNING" ? "  ⚠" : "  ·";
  console.log(`${tag} ${n.message}`);
});

// LACUNAS CONHECIDAS — allowlist explícita, uma entrada por arquivo, com motivo.
//
// ACHADO (2026-09-01): antes, TODA migração de módulo entrava como `tolerante`,
// e o rodapé chamava qualquer falha de "lacuna do que nunca foi versionado".
// A categoria era larga demais e absorveu quatro arquivos que existiam, estavam
// corretos e só rodavam fora de ordem — lidos como esperados por isso.
// Agora tolerar é decisão declarada arquivo a arquivo. Conjunto vazio = nada
// tolerado, que é o estado correto hoje.
//
// O QUE QUALIFICA UMA LACUNA REAL — leia antes de acrescentar entrada:
//   ✓ o arquivo depende de algo que NUNCA foi versionado (tabela criada à mão em
//     produção e nunca escrita em .sql), e há um plano de versionar;
//   ✓ o arquivo é de um módulo deliberadamente não instalado neste ambiente.
//   ✗ "não está aplicando e eu preciso do CI verde" NÃO qualifica;
//   ✗ falha por ordem entre módulos NÃO qualifica — conserte a ORDEM_MODULOS;
//   ✗ dependência que existe no repo mas roda depois NÃO qualifica — é ordem.
// O motivo escrito aqui é a única coisa que impede este Map de voltar a ser o
// balde genérico que escondeu o defeito de ordem por semanas.
const LACUNAS_CONHECIDAS = new Map([
  // "nome-do-arquivo.sql" => "por que esta lacuna é aceitável"
]);

const falhas = [];

async function aplicar([rel, _tol, base]) {
  const abs = path.join(base, rel);
  const nome = path.basename(rel);
  // `tolerante` vem da allowlist, nunca da posição na lista.
  const tolerante = LACUNAS_CONHECIDAS.has(nome);
  if (!fs.existsSync(abs)) {
    // Arquivo ausente ANTES nem entrava em `falhas`: sumia do rodapé e do exit
    // code. Some da lista de passos alguém apagar um .sql e o runner aplaudia.
    console.log(`  ⚠ ausente: ${nome}`);
    falhas.push(`${nome}: arquivo ausente`);
    return;
  }
  try {
    await client.query(fs.readFileSync(abs, "utf8"));
    console.log(`  ✓ ${nome}`);
  } catch (err) {
    if (tolerante) {
      console.log(`  ⚠ ${nome}: ${err.message.split("\n")[0]}`);
      falhas.push(`${nome}: ${err.message.split("\n")[0]}`);
      // Arquivo que abriu BEGIN e morreu no meio deixa a conexão em transação
      // abortada — todo comando seguinte falharia em cascata. Limpa antes de seguir.
      await client.query("ROLLBACK").catch(() => {});
    } else {
      console.error(`\n  ✗ ${nome} FALHOU\n    ${err.message}`);
      throw err;
    }
  }
}

try {
  await client.connect();
  console.log(`→ conectado\n`);

  console.log("→ schema + módulos + segurança");
  await client.query(PRELUDIO);
  console.log("  ✓ clinicas (inline)");
  for (const p of passos) await aplicar(p);

  console.log("\n→ seed (2 clínicas, para provar o cruzamento)");
  await client.query(`
    INSERT INTO clinicas (nome) SELECT '[TESTE] Clinica A'
      WHERE NOT EXISTS (SELECT 1 FROM clinicas WHERE nome = '[TESTE] Clinica A');
    INSERT INTO clinicas (nome) SELECT '[TESTE] Clinica B'
      WHERE NOT EXISTS (SELECT 1 FROM clinicas WHERE nome = '[TESTE] Clinica B');
  `);
  console.log("  ✓ ok");

  console.log("\n════════ CONTRACT-TEST DE SEGURANÇA ════════");
  await client.query(
    fs.readFileSync(path.join(PAINEL, ".planning/seguranca/002-contract-test.sql"), "utf8")
  );
  console.log("════════════════════════════════════════════");

  // Segundo contrato: direitos do titular. Faz BEGIN..ROLLBACK por conta própria,
  // então não deixa rastro — mas depende de registrar_consentimento existir.
  console.log("\n════════ CONTRACT-TEST DO TITULAR (LGPD) ════════");
  await client.query(
    fs.readFileSync(
      path.join(PAINEL, ".planning/seguranca/006-contract-test-titular.sql"),
      "utf8"
    )
  );
  console.log("═════════════════════════════════════════════════");

  // Terceiro contrato: fronteira de domínio do Prontuário. Excluído do
  // auto-discovery pelo regex NAO_E_MIGRACAO, como os outros contract-tests.
  console.log("\n════════ CONTRACT-TEST DA FRONTEIRA (PRONTUÁRIO) ════════");
  await client.query(
    fs.readFileSync(
      path.join(PAINEL, ".planning/prontuario/sql/002-contract-test-prontuario.sql"),
      "utf8"
    )
  );
  console.log("═════════════════════════════════════════════════════════");
  console.log("✅ nenhuma asserção falhou.");

  if (falhas.length) {
    // DERRUBA O EXIT CODE. Antes isto era só um aviso e o processo saía 0 — o
    // que contradizia em silêncio o critério de conclusão do PROJECT_SPEC §1
    // ("sem arquivo em ⚠ ausente ou falha tolerada") e tornava invisível o
    // defeito de ordem que existia há semanas.
    console.log(`\n❌ ${falhas.length} arquivo(s) não aplicaram:`);
    for (const f of falhas) console.log(`   - ${f}`);
    console.log(
      `\n   Schema INCOMPLETO. Se alguma destas é lacuna real e aceitável,` +
        `\n   declare em LACUNAS_CONHECIDAS com o motivo — nunca em silêncio.`
    );
    process.exitCode = 1;
  } else {
    console.log("\n✅ schema completo: nenhum arquivo pulado.");
  }

  if (ignorados.length) {
    console.log(
      `\nℹ️  ${ignorados.length} .sql não são migração e não foram aplicados` +
        ` (rascunho, inspeção, cleanup):`
    );
    for (const f of ignorados) console.log(`   · ${f}`);
    console.log("   Listados de propósito: antes sumiam sem deixar rastro.");
  }
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
