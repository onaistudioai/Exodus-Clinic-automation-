import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

/**
 * Extrai o catálogo `FERRAMENTAS` de `chat-ferramentas.ts` por AST em vez de
 * `import`: o arquivo abre com `import "server-only"` e usa o alias `@/`, e
 * arrasta `dal.ts` -> `next/navigation`, que só resolve dentro do bundler do
 * Next e cujas funções (`cookies()`/`headers()`) exigem um request real em
 * runtime. `typescript` já é devDependency do projeto — nenhuma dependência
 * nova, e nada é executado, só sintaxe.
 *
 * Compartilhado entre ferramentas-catalogo.test.ts (camada 1) e
 * tests/integration/roteamento-autorizacao.test.ts (camada 2) — mesma fonte,
 * duas provas diferentes, para não virar segunda lista escrita à mão.
 */

export interface FerramentaExtraida {
  nome: string;
  acao: string | undefined;
  tipo: string | undefined;
  properties: string[];
  required: string[];
}

export interface CatalogoExtraido {
  ferramentas: FerramentaExtraida[];
  /** Total de propriedades declaradas em `FERRAMENTAS`, para o extrator não poder perder nenhuma em silêncio. */
  totalDeclarado: number;
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

export function extrairFerramentas(sf: ts.SourceFile): CatalogoExtraido {
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

/** Lê e parseia `chat-ferramentas.ts` do disco. Caminho relativo a `tests/helpers/`. */
export function lerCatalogoReal(): CatalogoExtraido {
  const caminho = new URL("../../src/lib/chat-ferramentas.ts", import.meta.url);
  const fonte = fs.readFileSync(caminho, "utf-8");
  const sourceFile = ts.createSourceFile(caminho.pathname, fonte, ts.ScriptTarget.Latest, true);
  return extrairFerramentas(sourceFile);
}
