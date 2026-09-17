import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/**
 * Contrato das TRÊS peças que fazem uma negação de acesso virar 403 limpo em
 * vez de HTTP 500. Se qualquer uma sumir, as outras duas passam a não servir
 * para nada — e o sintoma reaparece só em produção, numa URL que quase ninguém
 * digita à mão.
 *
 * O QUE ESTE ARQUIVO NÃO É: prova de runtime. `src/lib/rbac.ts` abre com
 * `import "server-only"` e é inalcançável sob `node --test` (mesma cadeia da
 * camada 1). Isto lê o FONTE. A única prova de comportamento é o app rodando —
 * foi assim que o 500 foi descoberto, acessando /admin/usuarios como recepção
 * na verificação pós-deploy de 2026-09-05.
 *
 * Vale a pena mesmo assim: as três regressões que ele pega (voltar ao throw,
 * tirar a flag, apagar o forbidden.tsx) são silenciosas — nada quebra no build,
 * nada quebra em dev, e a página só falha para quem não tem permissão.
 */

const rbac = fs.readFileSync("src/lib/rbac.ts", "utf-8");
const config = fs.readFileSync("next.config.ts", "utf-8");

test("requireAcao interrompe com forbidden(), não com throw", () => {
  const corpo = rbac.match(/export async function requireAcao[\s\S]*?\n}/)?.[0];
  assert.ok(corpo, "não achei requireAcao em src/lib/rbac.ts");

  assert.match(
    corpo,
    /\bforbidden\(\)/,
    "requireAcao precisa chamar forbidden() — um throw comum vira HTTP 500 com a página de crash do Next"
  );
  assert.doesNotMatch(
    corpo,
    /throw new Error/,
    "voltou a lançar Error: em produção o Next apaga a mensagem, então nenhum error.tsx consegue distinguir negação de falha"
  );
  assert.match(
    rbac,
    /import \{[^}]*\bforbidden\b[^}]*\} from "next\/navigation"/,
    "forbidden() precisa vir de next/navigation"
  );
});

test("authInterrupts está ligado — sem a flag, forbidden() volta a ser um throw cru", () => {
  assert.match(
    config,
    /experimental:\s*\{[\s\S]*authInterrupts:\s*true/,
    "next.config.ts precisa de experimental.authInterrupts para forbidden() funcionar"
  );
});

test("app/forbidden.tsx existe e não conta o que a pessoa não pode fazer", () => {
  const caminho = "src/app/forbidden.tsx";
  assert.ok(fs.existsSync(caminho), `${caminho} é a UI que forbidden() renderiza`);

  const pagina = fs.readFileSync(caminho, "utf-8");
  assert.match(pagina, /export default function/, "precisa exportar um componente por default");

  // Não enumerar ação nem papel para quem foi barrado: quem chegou digitando a
  // URL não precisa de um mapa do que existe do outro lado. O detalhe fica no
  // log do servidor.
  for (const vazamento of ["gerir_usuarios", "ver_auditoria", "papel '"]) {
    assert.ok(
      !pagina.includes(vazamento),
      `a página de negação não deve citar "${vazamento}"`
    );
  }
});
