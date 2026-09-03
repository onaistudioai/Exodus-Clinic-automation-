import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

import { ACOES } from "../src/lib/rbac-matriz.ts";
import { selecionarFerramentas } from "../src/lib/catalogo-regra.ts";

/**
 * Camada 1 (RETOMADA.md §4) — contrato do catálogo do chat. Sem LLM, sem banco.
 *
 * `chat-ferramentas.ts` não pode ser importado por um teste puro: ele arrasta
 * `dal.ts` -> `next/navigation`, que só resolve dentro do bundler do Next e
 * cujas funções (`cookies()`/`headers()`) exigem um request real em runtime.
 * Por isso o catálogo é extraído por AST — só sintaxe, sem executar nada —
 * em vez de `import`. `typescript` já é devDependency do projeto.
 */

const CAMINHO = new URL("../src/lib/chat-ferramentas.ts", import.meta.url);
const FONTE = fs.readFileSync(CAMINHO, "utf-8");
const SOURCE_FILE = ts.createSourceFile(CAMINHO.pathname, FONTE, ts.ScriptTarget.Latest, true);

interface FerramentaExtraida {
  nome: string;
  acao: string | undefined;
  tipo: string | undefined;
  properties: string[];
  required: string[];
}

function nomeDaPropriedade(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name)) return name.text;
  return undefined;
}

function acharProp(obj: ts.ObjectLiteralExpression, nome: string): ts.Expression | undefined {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && nomeDaPropriedade(p.name) === nome) return p.initializer;
  }
  return undefined;
}

function stringLiteral(node: ts.Expression | undefined): string | undefined {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

interface CatalogoExtraido {
  ferramentas: FerramentaExtraida[];
  /** Total de propriedades declaradas em `FERRAMENTAS`, para o extrator não poder perder nenhuma em silêncio. */
  totalDeclarado: number;
}

function extrairFerramentas(sf: ts.SourceFile): CatalogoExtraido {
  let ferramentasObj: ts.ObjectLiteralExpression | undefined;

  sf.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const decl of node.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.name.text === "FERRAMENTAS" &&
        decl.initializer &&
        ts.isObjectLiteralExpression(decl.initializer)
      ) {
        ferramentasObj = decl.initializer;
      }
    }
  });
  assert.ok(ferramentasObj, "não achou `export const FERRAMENTAS = {...}` — o arquivo mudou de forma?");

  const resultado: FerramentaExtraida[] = [];
  for (const prop of ferramentasObj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const nome = nomeDaPropriedade(prop.name);
    if (!nome || !ts.isObjectLiteralExpression(prop.initializer)) continue;
    const def = prop.initializer;

    const acao = stringLiteral(acharProp(def, "acao"));

    const parametros = acharProp(def, "parametros");
    let tipo: string | undefined;
    let properties: string[] = [];
    let required: string[] = [];
    if (parametros && ts.isObjectLiteralExpression(parametros)) {
      tipo = stringLiteral(acharProp(parametros, "type"));

      const propsNode = acharProp(parametros, "properties");
      if (propsNode && ts.isObjectLiteralExpression(propsNode)) {
        properties = propsNode.properties
          .map((p) => (ts.isPropertyAssignment(p) ? nomeDaPropriedade(p.name) : undefined))
          .filter((x): x is string => Boolean(x));
      }

      const requiredNode = acharProp(parametros, "required");
      if (requiredNode && ts.isArrayLiteralExpression(requiredNode)) {
        required = requiredNode.elements
          .map((el) => stringLiteral(el))
          .filter((x): x is string => Boolean(x));
      }
    }

    resultado.push({ nome, acao, tipo, properties, required });
  }
  return { ferramentas: resultado, totalDeclarado: ferramentasObj.properties.length };
}

const { ferramentas: FERRAMENTAS, totalDeclarado } = extrairFerramentas(SOURCE_FILE);

test("o extrator não perde nenhuma ferramenta em silêncio: uma entrada extraída por propriedade declarada", () => {
  assert.equal(
    FERRAMENTAS.length,
    totalDeclarado,
    `AST declara ${totalDeclarado} propriedades em FERRAMENTAS mas o extrator só devolveu ${FERRAMENTAS.length}`
  );
});

test("toda ferramenta declara uma `acao` que existe no vocabulário — o mesmo que rbac.test.ts prova == tabela `acao`", () => {
  const vocabulario = new Set<string>(ACOES);
  for (const f of FERRAMENTAS) {
    assert.ok(f.acao, `${f.nome}: sem \`acao\` (ou não é um literal de string simples)`);
    assert.ok(vocabulario.has(f.acao!), `${f.nome}: acao "${f.acao}" não existe em ACOES`);
  }
});

test("`parametros` de cada ferramenta é um JSON schema válido: type object, required ⊆ properties", () => {
  for (const f of FERRAMENTAS) {
    assert.equal(f.tipo, "object", `${f.nome}: parametros.type deveria ser "object", é "${f.tipo}"`);
    for (const req of f.required) {
      assert.ok(
        f.properties.includes(req),
        `${f.nome}: required "${req}" não existe em properties (${f.properties.join(", ")})`
      );
    }
  }
});

test("catalogoDaSessao expõe exatamente permitidas ∪ sensíveis, nem uma a mais", () => {
  /**
   * Chama a função REAL de src/lib/catalogo-regra.ts (não uma cópia) com o
   * catálogo real extraído por AST e permitidas/sensiveis sintéticos — a
   * política real (`papel_acao`/`acao.sensivel`) é dado de banco, camada 2
   * do RETOMADA.md. `catalogoDaSessao()` em chat-ferramentas.ts delega nesta
   * mesma função, então isto prova a regra de produção, não uma cópia dela.
   */
  function selecionar(permitidas: Set<string>, sensiveis: Set<string>): string[] {
    return selecionarFerramentas(
      FERRAMENTAS.map((f) => ({ nome: f.nome, acao: f.acao! })),
      permitidas,
      sensiveis
    ).map((f) => f.nome);
  }

  const acoesDoCatalogo = [...new Set(FERRAMENTAS.map((f) => f.acao!))];
  assert.ok(acoesDoCatalogo.length >= 2, "teste precisa de pelo menos 2 acoes distintas no catálogo");
  const [acaoA, acaoB] = acoesDoCatalogo;

  // nada permitido, nada sensível: catálogo vazio
  assert.deepEqual(selecionar(new Set(), new Set()), []);

  // uma ação permitida, nada sensível: só as ferramentas dessa ação, nem uma a mais
  const esperadoA = FERRAMENTAS.filter((f) => f.acao === acaoA).map((f) => f.nome).sort();
  assert.deepEqual(selecionar(new Set([acaoA]), new Set()).sort(), esperadoA);

  // uma ação sensível fora das permitidas: aparece do mesmo jeito (senão a fila de aprovação nunca nasce)
  const esperadoB = FERRAMENTAS.filter((f) => f.acao === acaoB).map((f) => f.nome).sort();
  assert.deepEqual(selecionar(new Set(), new Set([acaoB])).sort(), esperadoB);

  // uma ação que não é permitida nem sensível: nunca aparece
  const semNenhuma = selecionar(new Set([acaoA]), new Set([acaoA]));
  for (const f of FERRAMENTAS.filter((x) => x.acao !== acaoA)) {
    assert.ok(!semNenhuma.includes(f.nome), `${f.nome} (acao "${f.acao}") não deveria aparecer`);
  }
});
