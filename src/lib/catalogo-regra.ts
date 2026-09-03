/**
 * A REGRA de seleção do catálogo de ferramentas do chat, isolada num módulo
 * puro (sem `server-only`, sem alias `@/`, sem banco) para ser testável por
 * `import` direto em `node --test` — ver chat-ferramentas.ts, que não pode.
 *
 * Uma ferramenta entra no catálogo se a ação for permitida ao papel OU se a
 * ação for sensível (mesmo sem permissão): é assim que uma tentativa vira
 * pedido de aprovação em vez de beco sem saída — ver o comentário no topo de
 * chat-ferramentas.ts para a decisão completa.
 */
export interface FerramentaBase {
  acao: string;
}

export function selecionarFerramentas<T extends FerramentaBase>(
  ferramentas: readonly T[],
  permitidas: ReadonlySet<string>,
  sensiveis: ReadonlySet<string>
): T[] {
  return ferramentas.filter((f) => permitidas.has(f.acao) || sensiveis.has(f.acao));
}
