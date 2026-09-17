#!/usr/bin/env node
/**
 * Wave 2 do onboarding — provisiona uma clínica e o admin inicial dela.
 *
 * Substitui o INSERT manual que era o ÚNICO caminho até hoje
 * (o seed de usuário de teste em sofia-demo/sql/, com hash bcrypt colado à mão
 * dentro do arquivo versionado).
 *
 * Roda como neondb_owner, de propósito: criar clínica é a única operação do
 * sistema que acontece SEM tenant — a clínica ainda não existe para ser o
 * tenant. É o mesmo problema que fn_login_lookup resolve para o login. A saída
 * escolhida aqui é não ter caminho de aplicação nenhum: sem rota, sem papel
 * acima de admin, sem SECURITY DEFINER nova (o que também mantém isto fora do
 * contract-test de funcao_alcance).
 *
 * Uso:
 *   node scripts/provisionar-clinica.mjs \
 *     --nome "Clínica X" --slug clinica-x \
 *     --admin-email pessoa@exemplo.com --admin-nome "Fulana" \
 *     [--timezone America/Belem] \
 *     [--wa-provedor waha --wa-id sofia-x --wa-numero +5511999999999]
 *
 * O canal de WhatsApp é opcional: uma clínica pode existir sem ele (o painel
 * funciona inteiro). Mas sem canal ela NÃO recebe mensagem — é a linha em
 * `clinica_canal` que diz de qual clínica é uma mensagem que chega, e essa
 * resolução acontece antes de existir tenant (acesso-019).
 *
 * Idempotente: rodar duas vezes não duplica nem sobrescreve. Se a clínica ou o
 * usuário já existirem, avisa e não mexe — em particular NÃO reseta a senha de
 * um admin existente, porque isso derrubaria o acesso de quem já usa.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import pg from "pg";
import bcrypt from "bcryptjs";

const CRED = "D:/projetos/.credentials/exodus/postgres.env";

// Mesmo custo de hashSenha() em src/lib/auth.ts:41. Não dá para importar de lá:
// o módulo abre com `import "server-only"` e é inalcançável fora do runtime do
// Next (mesma cadeia que bloqueia chat-ferramentas.ts). tests/integration/
// onboarding.test.ts amarra os dois — se um mudar sem o outro, o teste reprova.
const BCRYPT_COST = 12;

function lerCredencial(chave) {
  const conteudo = fs.readFileSync(CRED, "utf-8");
  const m = conteudo.match(new RegExp(`^\\s*${chave}\\s*=\\s*['"]?([^'"\\r\\n]+)`, "m"));
  if (!m) throw new Error(`${chave} não encontrada em ${CRED}`);
  return m[1].trim();
}

function args() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    out[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") ? "" : argv[++i] ?? "";
  }
  return out;
}

// Validação antes de tocar o banco: erro de digitação em slug vira uma clínica
// órfã que ninguém consegue deletar depois (modelo append-only, REVOKE DELETE).
function validar(a) {
  const erros = [];
  if (!a.nome?.trim()) erros.push("--nome é obrigatório");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(a.slug ?? ""))
    erros.push("--slug deve ser minúsculo, sem espaço nem acento (ex: clinica-aurora)");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a["admin-email"] ?? ""))
    erros.push("--admin-email inválido");
  if (!a["admin-nome"]?.trim()) erros.push("--admin-nome é obrigatório");

  // Canal é opcional (clínica pode existir sem WhatsApp), mas se vier tem de
  // vir inteiro: um identificador sem provedor não resolve tenant nenhum.
  const temProvedor = Boolean(a["wa-provedor"]);
  const temId = Boolean(a["wa-id"]);
  if (temProvedor !== temId)
    erros.push("--wa-provedor e --wa-id andam juntos: um sem o outro não resolve tenant");
  if (temProvedor && !["waha", "meta"].includes(String(a["wa-provedor"])))
    erros.push("--wa-provedor precisa ser 'waha' ou 'meta'");
  return erros;
}

async function main() {
  const a = args();
  const erros = validar(a);
  if (erros.length) {
    console.error("provisionar-clinica: " + erros.join("\n                     "));
    console.error(
      '\nUso: node scripts/provisionar-clinica.mjs --nome "Clínica X" --slug clinica-x \\\n' +
        '       --admin-email pessoa@exemplo.com --admin-nome "Fulana" \\\n' +
        "       [--timezone America/Sao_Paulo] \\\n" +
        "       [--wa-provedor waha|meta --wa-id <sessão ou phone_number_id> --wa-numero +55...]"
    );
    process.exit(1);
  }

  // base64url para a senha caber num WhatsApp sem virar dois campos por causa
  // de um caractere que o app de mensagem resolve escapar.
  const senha = crypto.randomBytes(12).toString("base64url");
  const senhaHash = await bcrypt.hash(senha, BCRYPT_COST);

  const client = new pg.Client({ connectionString: lerCredencial("DATABASE_URL_OWNER_BR") });
  await client.connect();

  try {
    await client.query("BEGIN");

    // A clínica e o admin nascem juntos ou nenhum dos dois: uma clínica sem
    // admin é inacessível E indeletável (append-only) — lixo permanente.
    const tz = a.timezone?.trim();
    const clinica = await client.query(
      tz
        ? `INSERT INTO clinicas (nome, slug, ativa, timezone) VALUES ($1, $2, true, $3)
             ON CONFLICT (slug) DO NOTHING RETURNING id`
        : `INSERT INTO clinicas (nome, slug, ativa) VALUES ($1, $2, true)
             ON CONFLICT (slug) DO NOTHING RETURNING id`,
      tz ? [a.nome.trim(), a.slug, tz] : [a.nome.trim(), a.slug]
    );

    let clinicaId = clinica.rows[0]?.id;
    let clinicaNova = clinicaId !== undefined;
    if (!clinicaNova) {
      const { rows } = await client.query(`SELECT id FROM clinicas WHERE slug = $1`, [a.slug]);
      clinicaId = rows[0]?.id;
      if (clinicaId === undefined) throw new Error(`slug ${a.slug} conflitou mas não foi encontrado`);
    }

    // uq_usuarios_email_por_clinica é um índice PARCIAL (WHERE email IS NOT
    // NULL) — o ON CONFLICT precisa repetir o predicado, senão o Postgres não
    // casa o índice e o INSERT lança em vez de ser ignorado.
    const usuario = await client.query(
      `INSERT INTO usuarios (clinica_id, nome, papel, email, senha_hash, ativo)
            VALUES ($1, $2, 'admin', $3, $4, true)
         ON CONFLICT (clinica_id, lower(email)) WHERE email IS NOT NULL
         DO NOTHING RETURNING id`,
      [clinicaId, a["admin-nome"].trim(), a["admin-email"].trim(), senhaHash]
    );

    // Canal de WhatsApp (acesso-019). Sem esta linha, uma mensagem que chegue
    // para esta clínica não tem como saber que é dela — a resolução de tenant
    // acontece ANTES de existir tenant, e é esta tabela que a sustenta.
    let canal = null;
    if (a["wa-provedor"]) {
      const r = await client.query(
        `INSERT INTO clinica_canal (clinica_id, provedor, identificador, numero_e164)
              VALUES ($1, $2, $3, $4)
           ON CONFLICT (provedor, identificador) DO NOTHING
        RETURNING id`,
        [clinicaId, a["wa-provedor"], String(a["wa-id"]).trim(), a["wa-numero"]?.trim() || null]
      );
      canal = r.rows[0]?.id ?? "conflito";
    }

    await client.query("COMMIT");

    const adminNovo = usuario.rows.length > 0;
    console.log(`\nclínica  #${clinicaId} ${a.nome.trim()} (${a.slug})${clinicaNova ? "" : "  [já existia, reaproveitada]"}`);
    if (canal === "conflito") {
      console.log(
        `canal    ${a["wa-provedor"]}:${a["wa-id"]}  [JÁ PERTENCE A OUTRA CLÍNICA — nada foi alterado]`
      );
    } else if (canal) {
      console.log(`canal    #${canal} ${a["wa-provedor"]}:${a["wa-id"]}`);
    } else {
      console.log(`canal    (nenhum) — esta clínica não recebe WhatsApp até ter um`);
    }

    if (adminNovo) {
      console.log(`admin    #${usuario.rows[0].id} ${a["admin-email"].trim()}`);
      // Única vez que esta senha existe em texto claro em qualquer lugar. Não
      // vai para arquivo, log ou commit — se a janela do terminal sumir, o
      // caminho é criar outro admin, não recuperar esta.
      console.log(`\n  senha inicial: ${senha}`);
      console.log(`  Anote agora. Não é recuperável — só aparece aqui, uma vez.`);
      console.log(`  Passe por um canal privado e peça a troca em /conta/senha no primeiro acesso.\n`);
    } else {
      console.log(`admin    ${a["admin-email"].trim()}  [já existia — senha NÃO foi alterada]`);
      console.log(`\n  Nada a fazer. Para trocar a senha de um admin existente, use /conta/senha`);
      console.log(`  logado como ele — este script não reseta senha de propósito.\n`);
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    // Num finally: se o ROLLBACK acima explodir, sem isto a conexão fica aberta
    // e o processo pendura sem imprimir nada (mesma armadilha da dívida #9b).
    await client.end();
  }
}

main().catch((e) => {
  console.error("provisionar-clinica falhou:", e.message);
  process.exit(1);
});
