import { register } from "node:module";
register("./helpers/stub-server-only.mjs", import.meta.url);

import { lerCatalogoCompleto } from "../tests/helpers/extrair-ferramentas.ts";
import type { Mensagem } from "../src/lib/llm.ts";

/**
 * Camada 3 (RETOMADA.md §4) — trajetória, COM LLM, 20-30 casos-âncora à mão.
 *
 * NÃO É GATE DE CI. Roda fora do `npm test` (não está em tests/**), como
 * script manual — é por isso que vive em scripts/, não em tests/. A
 * literatura pede ≥500 casos para uma métrica agregada confiável; tratar
 * 25 como métrica seria pior que não ter nenhuma. Isto é um RELATÓRIO:
 * ferramenta escolhida certa? parâmetros extraídos certos? NUNCA o texto
 * da resposta — o modelo pode responder bonito e ainda ter chamado a
 * ferramenta errada, ou com o parâmetro errado.
 *
 * DADO SINTÉTICO SEMPRE. Nenhum caso abaixo usa nome, telefone ou id real
 * de paciente — o prompt sai da máquina para a API do Groq, e o sistema
 * carrega dado de saúde.
 *
 * Uso: node --experimental-strip-types scripts/camada3-trajetoria.ts
 * Precisa de GROQ_API_KEY (cofre local, groq.env) — rode via
 * `node scripts/test-env.mjs -- --experimental-strip-types scripts/camada3-trajetoria.ts`.
 */

// Mesmo texto de src/app/api/chat/route.ts:26-34 (promptDeSistema) — copiado,
// não importado, pelo mesmo motivo de chat-ferramentas.ts não ser importável
// (arrasta next/navigation). É só o prompt de sistema, não lógica de
// segurança: nada aqui decide autorização.
function promptDeSistema(rotuloPapel: string): string {
  return [
    "Você é a assistente interna do painel da clínica. Responda em português do Brasil, de forma curta e direta.",
    `Quem está falando com você tem o papel: ${rotuloPapel}.`,
    "Use as ferramentas para consultar dados reais. Nunca invente números, saldos ou valores: se não tiver a informação, diga que não tem.",
    "Antes de executar qualquer ação que altere dados, confirme com a pessoa o que exatamente será feito.",
    "Se uma ação retornar que virou pedido de aprovação, explique com clareza que ela NÃO foi executada e informe o número do pedido.",
  ].join(" ");
}

interface Caso {
  pergunta: string;
  /** null = espera que o modelo NÃO chame nenhuma ferramenta. */
  esperado: string | null;
  /** Só roda se `esperado` não for null e o modelo acertou a ferramenta. */
  verificarParametros?: (args: Record<string, unknown>) => string | null; // null = ok, string = motivo da falha
  /**
   * Caso de escrita: o prompt de sistema manda confirmar antes de agir, então
   * o harness vira 2 turnos. Turno 1 tem de vir SEM tool_call (a confirmação
   * sendo respeitada); turno 2, depois de "Sim, confirmo", é que cobra a
   * ferramenta/parâmetros. Sem essa marca o caso é medido em 1 turno só, o
   * que classificava a confirmação funcionando como se fosse a trajetória
   * falhando (era exatamente o bug do relatório de 03/09).
   */
  confirmaAntes?: true;
}

const ID = (v: unknown) => (typeof v === "number" || /^\d+$/.test(String(v)));
const NAO_VAZIO = (v: unknown) => typeof v === "string" && v.trim().length > 0;

const CASOS: Caso[] = [
  // ------------------------------------------------------------- leitura
  { pergunta: "Quais produtos estão com estoque baixo ou perto de vencer?", esperado: "consultar_estoque" },
  { pergunta: "Precisamos repor algum produto? Mostra os alertas do estoque.", esperado: "consultar_estoque" },
  { pergunta: "Faz um resumo financeiro do mês pra mim.", esperado: "consultar_financeiro" },
  { pergunta: "Como está o caixa da clínica hoje?", esperado: "consultar_financeiro" },
  { pergunta: "Lista os pacientes com cobranças vencidas e não pagas.", esperado: "consultar_inadimplentes" },
  {
    pergunta: "O que tem marcado na agenda para o dia 2026-09-10?",
    esperado: "consultar_agenda_do_dia",
    verificarParametros: (a) => (a.data === "2026-09-10" ? null : `data esperada "2026-09-10", veio "${a.data}"`),
  },
  {
    pergunta: "Mostra os agendamentos do dia 2026-12-25.",
    esperado: "consultar_agenda_do_dia",
    verificarParametros: (a) => (a.data === "2026-12-25" ? null : `data esperada "2026-12-25", veio "${a.data}"`),
  },
  { pergunta: "Tem algum pedido de aprovação esperando decisão?", esperado: "consultar_pedidos_de_aprovacao" },
  { pergunta: "Quais pacientes estão inadimplentes no pipeline de relacionamento?", esperado: "consultar_crm" },
  { pergunta: "Quais pacientes novos entraram no funil de relacionamento essa semana?", esperado: "consultar_crm" },
  { pergunta: "Me mostra o pipeline completo do CRM, todos os estágios.", esperado: "consultar_crm" },
  { pergunta: "Como está indo a campanha de reativação de pacientes inativos?", esperado: "consultar_reativacao" },
  { pergunta: "Quantos pacientes já reativaram na campanha atual?", esperado: "consultar_reativacao" },
  { pergunta: "Tem algum atendimento esperando um humano assumir?", esperado: "consultar_escalonamento" },
  { pergunta: "Mostra a fila de quem está esperando atendimento humano.", esperado: "consultar_escalonamento" },
  { pergunta: "Quem acessou o prontuário recentemente?", esperado: "consultar_auditoria" },
  { pergunta: "Preciso da trilha de acessos ao prontuário dos últimos dias.", esperado: "consultar_auditoria" },

  // ------------------------------------------------------------- escrita
  {
    pergunta: "Contei o lote 42 na conferência física e tem 15 unidades, ajusta o estoque.",
    esperado: "ajustar_inventario",
    confirmaAntes: true,
    verificarParametros: (a) =>
      Number(a.loteId) === 42 && Number(a.quantidadeContada) === 15
        ? null
        : `esperava loteId=42, quantidadeContada=15 — veio ${JSON.stringify(a)}`,
  },
  {
    pergunta: "A cobrança 501 foi paga no pix, registra a baixa.",
    esperado: "registrar_pagamento",
    confirmaAntes: true,
    verificarParametros: (a) =>
      Number(a.cobrancaId) === 501 && String(a.formaPagamento).toLowerCase().includes("pix")
        ? null
        : `esperava cobrancaId=501, formaPagamento~pix — veio ${JSON.stringify(a)}`,
  },
  {
    pergunta: "Cancela a cobrança 77, o paciente desistiu do procedimento.",
    esperado: "cancelar_cobranca",
    confirmaAntes: true,
    verificarParametros: (a) =>
      Number(a.cobrancaId) === 77 && NAO_VAZIO(a.motivo) ? null : `esperava cobrancaId=77 e motivo não-vazio — veio ${JSON.stringify(a)}`,
  },
  {
    pergunta: "Marca uma consulta pro paciente 12 com o profissional 3, serviço 5, dia 10/09/2026 às 14h.",
    esperado: "criar_agendamento",
    confirmaAntes: true,
    verificarParametros: (a) =>
      Number(a.pacienteId) === 12 &&
      Number(a.profissionalId) === 3 &&
      Number(a.servicoId) === 5 &&
      String(a.inicio).startsWith("2026-09-10T14:00")
        ? null
        : `esperava paciente 12/profissional 3/serviço 5 às 2026-09-10T14:00 — veio ${JSON.stringify(a)}`,
  },
  {
    pergunta: "Remarca o agendamento 88 para o dia 12/09/2026 às 9h.",
    esperado: "mover_agendamento",
    confirmaAntes: true,
    verificarParametros: (a) =>
      Number(a.agendamentoId) === 88 && String(a.novoInicio).startsWith("2026-09-12T09:00")
        ? null
        : `esperava agendamentoId=88, novoInicio 2026-09-12T09:00 — veio ${JSON.stringify(a)}`,
  },
  {
    pergunta: "Cancela o agendamento 99, o paciente desmarcou.",
    esperado: "cancelar_agendamento",
    confirmaAntes: true,
    verificarParametros: (a) => (Number(a.agendamentoId) === 99 ? null : `esperava agendamentoId=99 — veio ${JSON.stringify(a)}`),
  },

  // ------------------------------------------------------- sem ferramenta
  { pergunta: "Bom dia! Tudo certo por aí?", esperado: null },
  { pergunta: "Cancela isso.", esperado: null }, // sem id nenhum: deveria pedir esclarecimento, não chutar
];

interface Resultado {
  pergunta: string;
  esperado: string | null;
  /** "n/a" = caso de leitura, não passa por confirmação em 2 turnos. */
  confirmacaoRespeitada: boolean | "n/a";
  ferramentaEscolhida: string | null;
  ferramentaOk: boolean;
  parametrosOk: boolean | "n/a";
  motivoFalhaParametros: string | null;
  erro: string | null;
}

// ponytail: backoff SÓ para 429 do provedor — o plano free do Groq rejeita uma
// rajada de 25 chamadas seguidas, e sem isso o relatório vira 16 linhas de
// "erro de rede" que não dizem nada sobre trajetória. Não é retry genérico:
// qualquer outro erro sobe na hora, senão uma falha real se disfarça de
// tentativa. Teto ~62s por caso; se ainda bater 429, o caso reporta o erro.
async function comBackoff<T>(fn: () => Promise<T>, tentativas = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("429") || i >= tentativas) throw e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
}

async function main() {
  if (!process.env.GROQ_API_KEY) {
    console.error(
      "GROQ_API_KEY ausente. Rode via: node scripts/test-env.mjs -- --experimental-strip-types scripts/camada3-trajetoria.ts"
    );
    process.exitCode = 0; // relatório, não gate — não falha o processo por env ausente
    return;
  }

  const { chamarLLM } = (await import("../src/lib/llm.ts")) as typeof import("../src/lib/llm.ts");
  const ferramentas = lerCatalogoCompleto();
  const prompt = promptDeSistema("administrador");

  const resultados: Resultado[] = [];

  for (const caso of CASOS) {
    const mensagens: Mensagem[] = [
      { role: "system", content: prompt },
      { role: "user", content: caso.pergunta },
    ];

    try {
      let respostaFinal: Awaited<ReturnType<typeof chamarLLM>>;
      let confirmacaoRespeitada: boolean | "n/a" = "n/a";

      if (caso.confirmaAntes) {
        // Turno 1: espera NENHUMA tool_call — a regra do prompt de sistema é
        // "confirme antes de agir". Chamar a ferramenta direto aqui é falha,
        // mesmo que o turno 2 acerte tudo depois.
        const turno1 = await comBackoff(() => chamarLLM(mensagens, ferramentas));
        confirmacaoRespeitada = turno1.tool_calls.length === 0 && NAO_VAZIO(turno1.content);

        const mensagensTurno2: Mensagem[] = [
          ...mensagens,
          { role: "assistant", content: turno1.content },
          { role: "user", content: "Sim, confirmo. Pode executar." },
        ];
        respostaFinal = await comBackoff(() => chamarLLM(mensagensTurno2, ferramentas));
      } else {
        respostaFinal = await comBackoff(() => chamarLLM(mensagens, ferramentas));
      }

      const chamada = respostaFinal.tool_calls[0];
      const ferramentaEscolhida = chamada?.function.name ?? null;
      const ferramentaOk = ferramentaEscolhida === caso.esperado;

      let parametrosOk: boolean | "n/a" = "n/a";
      let motivoFalhaParametros: string | null = null;
      if (ferramentaOk && caso.esperado && caso.verificarParametros) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(chamada?.function.arguments || "{}");
        } catch {
          motivoFalhaParametros = "arguments não é JSON válido";
        }
        if (!motivoFalhaParametros) {
          motivoFalhaParametros = caso.verificarParametros(args);
        }
        parametrosOk = motivoFalhaParametros === null;
      }

      resultados.push({
        pergunta: caso.pergunta,
        esperado: caso.esperado,
        confirmacaoRespeitada,
        ferramentaEscolhida,
        ferramentaOk,
        parametrosOk,
        motivoFalhaParametros,
        erro: null,
      });
    } catch (e) {
      resultados.push({
        pergunta: caso.pergunta,
        esperado: caso.esperado,
        confirmacaoRespeitada: "n/a", // erro de rede/API, não dá pra dizer se a confirmação seria respeitada
        ferramentaEscolhida: null,
        ferramentaOk: false,
        parametrosOk: "n/a",
        motivoFalhaParametros: null,
        erro: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ---------------------------------------------------------------- relatório
  console.log("\nCamada 3 — trajetória com LLM. RELATÓRIO, não gate de CI.\n");
  for (const r of resultados) {
    const marcaFerramenta = r.erro ? "ERRO" : r.ferramentaOk ? "OK" : "FALHOU";
    const marcaParametros = r.parametrosOk === "n/a" ? "" : r.parametrosOk ? " | params OK" : ` | params FALHOU (${r.motivoFalhaParametros})`;
    const marcaConfirmacao = r.confirmacaoRespeitada === "n/a" ? "" : r.confirmacaoRespeitada ? " | confirmação OK (turno 1 sem tool_call)" : " | confirmação FALHOU (chamou ferramenta direto no turno 1)";
    console.log(`[${marcaFerramenta}] "${r.pergunta}"`);
    console.log(`         esperado=${r.esperado ?? "(nenhuma)"} escolhido=${r.ferramentaEscolhida ?? "(nenhuma)"}${marcaParametros}${marcaConfirmacao}`);
    if (r.confirmacaoRespeitada === false) {
      console.log(`         >>> NÃO CONTA COMO OK mesmo que ferramenta/params tenham batido no turno 2 — a regra de confirmar antes de agir foi ignorada.`);
    }
    if (r.erro) console.log(`         erro: ${r.erro}`);
  }

  const totalFerramenta = resultados.filter((r) => !r.erro).length;
  const acertosFerramenta = resultados.filter((r) => !r.erro && r.ferramentaOk).length;
  const casosComParametro = resultados.filter((r) => r.parametrosOk !== "n/a");
  const acertosParametro = casosComParametro.filter((r) => r.parametrosOk === true).length;
  const erros = resultados.filter((r) => r.erro).length;

  const casosConfirmacao = resultados.filter((r) => r.confirmacaoRespeitada !== "n/a");
  const confirmacoesOk = casosConfirmacao.filter((r) => r.confirmacaoRespeitada === true).length;
  const casosEscritaCompletos = resultados.filter((r) => r.confirmacaoRespeitada === true && r.ferramentaOk);

  console.log("\n--- resumo (bruto, sem arredondar) ---");
  console.log(`ferramenta certa (turno único p/ leitura, turno 2 p/ escrita): ${acertosFerramenta} de ${totalFerramenta}`);
  console.log(`parâmetros certos (quando a ferramenta certa foi escolhida): ${acertosParametro} de ${casosComParametro.length}`);
  console.log(`confirmação respeitada no turno 1 (só casos de escrita): ${confirmacoesOk} de ${casosConfirmacao.length}`);
  console.log(`casos de escrita OK nas DUAS pontas (confirmou E acertou a ferramenta): ${casosEscritaCompletos.length} de ${casosConfirmacao.length}`);
  if (erros > 0) console.log(`chamadas com erro de rede/API (não contam como acerto nem erro de trajetória): ${erros}`);
  console.log(
    "\nLembrete: <500 casos não sustenta uma métrica agregada (ex: taxa de acerto) — isto é leitura de casos individuais, não gate."
  );
}

main();
