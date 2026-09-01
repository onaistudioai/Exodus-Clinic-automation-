// schema-modulos.mjs — FONTE ÚNICA de quais módulos existem, em que ordem, e o
// que dentro deles é migração. Consultada por verify.mjs (produção) e por
// scripts/test-db.mjs (CI).
//
// ACHADO (2026-09-01): antes desta extração, a mesma ordem vivia escrita à mão
// em dois arquivos — verify.mjs a descobria por módulo, test-db.mjs listava
// arquivo por arquivo. As duas listas já discordavam sem que ninguém tivesse
// editado nenhuma delas de propósito: test-db.mjs cobria 5 dos 9 módulos com
// sql/ (crm, estoque, financeiro e prontuario ficavam de fora), e só por sorte
// a ordem relativa dos 5 que cobria batia com a de verify.mjs. Duas fontes que
// podem divergir são o mesmo defeito que a ordem alfabética já causou uma vez
// — well documentado abaixo. Consolidado num arquivo, divergência entre os
// dois runners fica estruturalmente impossível: mudar a ordem é mudar aqui.
import fs from "node:fs";
import path from "node:path";

// O que NÃO é migração e por isso não entra no loop de aplicação automática:
//   contract-test / prove -> asserção, roda depois e cria dado de teste
//   verify / seed         -> script auxiliar ou dado de exemplo
//   preflight              -> checagem read-only de pré-requisito
export const NAO_E_MIGRACAO = /contract-test|prove|verify|seed|preflight/;

// ORDEM EXPLÍCITA DOS MÓDULOS.
//
// ACHADO (2026-09-01): a ordem era a do `readdir`, isto é, alfabética por
// acaso. `reativacao` caía por último, mas `reativacao/004-consentimento` cria
// `marketing_optin` e `007-escalonamentos` cria a tabela `escalonamentos` — dos
// quais `camada-a/003-lead`, `camada-a/004-telemetria` e
// `camada-a-v2/001-guardrail`/`002-destino-escalada` dependem. Numa instalação
// NOVA, quatro migrações falhavam e o runner terminava com exit 0. Na SEGUNDA
// execução elas passavam, porque as dependências já existiam: um instalador
// que só produz schema completo se rodar duas vezes.
//
// Por isso a ordem é declarada, e não parcial: declarar metade e deixar metade
// alfabética recria o mesmo acidente na fronteira entre as duas.
//
// `crm`, `estoque`, `financeiro`, `prontuario` não têm dependência entre si nem
// dos módulos acima — checado em 2026-09-01 (a única referência cruzada real,
// estoque/financeiro -> prontuario_entradas, é satisfeita pelo PRELÚDIO de cada
// runner, que cria essa tabela antes do loop de módulos começar).
//
// `acesso` (também 2026-09-01, sessão par `unify-chat-rbac-layer`) precisa vir
// ANTES da cauda de `seguranca/`, que não está em ORDEM_MODULOS — é apendada
// depois do loop inteiro pelos dois runners. Por isso a posição dentro do loop
// não precisa ser logo após camada-a-v2 por necessidade técnica (nada nos 4
// módulos de domínio depende de `acesso` nem o contrário); é só onde faz mais
// sentido ler.
export const ORDEM_MODULOS = [
  "agenda-turnos",   // só depende do prelúdio
  "reativacao",      // ANTES de camada-a: cria marketing_optin (004) e escalonamentos (007)
  "bot-agendamento", // cria eventos_agendamento e notificacoes_saida, que camada-a altera
  "camada-a",        // 003-lead precisa de marketing_optin; 004-telemetria precisa de origem (003)
  "camada-a-v2",     // guardrail e destino-escalada precisam de escalonamentos
  "acesso",          // só precisa de `usuarios` (prelúdio); tem de existir ANTES
                     // de seguranca/007 poder trancar papel/acao/papel_acao
  "crm",
  "estoque",
  "financeiro",
  "prontuario",
];

/**
 * Varre `.planning/<modulo>/sql` para cada módulo de ORDEM_MODULOS presente no
 * repo e devolve os passos [caminho-relativo-a-painel, painel] na ordem certa.
 *
 * Lança (não retorna erro) em dois casos, de propósito — quem chama decide
 * como reportar, mas nenhum dos dois pode passar em silêncio:
 *   - módulo com sql/ mas sem posição declarada em ORDEM_MODULOS;
 *   - arquivo com numeração de 1-2 dígitos (`01-`, `1-`) — parece migração e
 *     nunca rodaria, porque o filtro exige três dígitos. É erro de numeração,
 *     não rascunho.
 *
 * `ignorados` (2º campo do retorno) é informativo: .sql que existe, não é
 * migração e não é rascunho reconhecido pelo NAO_E_MIGRACAO — normalmente
 * rascunho/inspeção/cleanup. Listado para não sumir sem deixar rastro.
 */
export function construirPassosDosModulos(painel) {
  const modulosComSql = fs
    .readdirSync(path.join(painel, ".planning"))
    .filter((d) => fs.existsSync(path.join(painel, ".planning", d, "sql")));

  const semPosicao = modulosComSql.filter((d) => !ORDEM_MODULOS.includes(d));
  if (semPosicao.length) {
    throw new Error(
      `módulo(s) sem posição declarada em ORDEM_MODULOS: ${semPosicao.join(", ")}. ` +
        `Acrescente cada um na posição correta em schema-modulos.mjs e diga de que ele depende.`
    );
  }

  const passos = [];
  const ignorados = [];
  const malNumerados = [];

  for (const dir of ORDEM_MODULOS) {
    if (!modulosComSql.includes(dir)) continue;
    const sqlDir = path.join(painel, ".planning", dir, "sql");
    const todos = fs.readdirSync(sqlDir).filter((f) => f.endsWith(".sql"));
    const migracoes = todos
      .filter((f) => /^\d{3}-.*\.sql$/.test(f) && !NAO_E_MIGRACAO.test(f))
      .sort(); // intra-módulo o prefixo NNN- É a declaração de ordem
    for (const f of migracoes) {
      passos.push([path.join(".planning", dir, "sql", f), painel]);
    }
    for (const f of todos) {
      if (migracoes.includes(f) || NAO_E_MIGRACAO.test(f)) continue;
      if (/^\d{1,2}-/.test(f)) malNumerados.push(`${dir}/sql/${f}`);
      else ignorados.push(`${dir}/sql/${f}`);
    }
  }

  if (malNumerados.length) {
    throw new Error(
      `arquivo(s) com numeração inválida — parecem migração e nunca rodariam: ` +
        malNumerados.join(", ") +
        `. O prefixo tem de ter três dígitos (001-, 002-, ...).`
    );
  }

  return { passos, ignorados };
}
