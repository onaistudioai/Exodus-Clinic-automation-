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
import { construirPassosDosModulos } from "./schema-modulos.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../../..");
const PAINEL = path.resolve(AQUI, "../..");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Defina DATABASE_URL (branch descartável do Neon).");
  process.exit(1);
}

// Passos: [caminho, base]. Tolerância deixou de ser campo posicional — vem só
// de LACUNAS_CONHECIDAS, mais abaixo (ver comentário ali para o motivo).
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

// O 2º elemento de cada tripla era um booleano de tolerância lido diretamente
// aqui. Desde 2026-09-01 (dae20bf) `aplicar()` ignora essa posição e só tolera
// pelo allowlist `LACUNAS_CONHECIDAS` — por isso as triplas abaixo não carregam
// mais `true`/`false` residual: era código morto, e um `true` esquecido aqui
// mascarava exatamente o tipo de silêncio que a correção existe para eliminar.
const passos = [
  // roles ANTES do schema: todo 001-*.sql de modulo termina com GRANT TO app_painel.
  ['.planning/seguranca/000-roles.sql', PAINEL],
  // bella cria agendamentos_sofia_demo; f02 depois adiciona clinica_id nela.
  // Ambos IF NOT EXISTS / IF NOT EXISTS-guarded; provados limpos (sem ⚠) nas
  // 4 rodadas de 2026-09-01 — não têm razão documentada para tolerância.
  ["sofia-demo/sql/schema-agendamentos-bella.sql", RAIZ],
  ["sofia-demo/sql/migration-f02-multitenant.sql", RAIZ],
  ["sofia-demo/sql/DRAFT-prontuario-modelo.sql", RAIZ],
];

// ORDEM_MODULOS e a descoberta de migração por módulo vivem em
// schema-modulos.mjs — FONTE ÚNICA compartilhada com scripts/test-db.mjs. Ver
// aquele arquivo para o histórico completo do defeito de ordem (2026-09-01).
let ignorados;
try {
  const r = construirPassosDosModulos(PAINEL);
  passos.push(...r.passos);
  ignorados = r.ignorados;
} catch (err) {
  console.error(`
❌ ${err.message}`);
  process.exit(1);
}

passos.push(
  [".planning/seguranca/004-auth-e-grants.sql", PAINEL],
  [".planning/seguranca/003-rate-limit.sql", PAINEL],
  // 005 depende de registrar_consentimento (reativacao/004). INTOLERANTE de
  // propósito: se aquela migração não aplicou, um banco sem os direitos do
  // titular tem de fazer barulho aqui, não descobrir no primeiro pedido real.
  [".planning/seguranca/005-titular.sql", PAINEL],
  [".planning/seguranca/001-lockdown.sql", PAINEL],
  // POR ÚLTIMO, e o "último" é o ponto: 004 acima faz
  // `GRANT SELECT, INSERT, UPDATE ON ALL TABLES ... TO app_painel`, o que desfaz
  // o REVOKE que camada-a-v2/007 e /008 aplicam nas tabelas de regra. Sem esta
  // linha, o deploy real reabre a escalada de privilégio que o teste não vê.
  [".planning/seguranca/007-fonte-da-verdade-somente-leitura.sql", PAINEL]
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

async function aplicar([rel, base]) {
  const abs = path.join(base, rel);
  const nome = path.basename(rel);
  // `tolerante` vem SÓ da allowlist — não existe mais posição na tripla para
  // isso. Ver comentário acima de `passos`.
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
