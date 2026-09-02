import "server-only";
import type { Tx } from "@/lib/db";
import type { Acao } from "@/lib/rbac-matriz";
import { acoesPermitidas, metaDaAcao } from "@/lib/rbac";
import type { FerramentaExposta } from "@/lib/llm";
import * as estoque from "@/server/estoque.repo";
import * as financeiro from "@/server/financeiro.repo";
import * as agenda from "@/server/agenda.repo";
import * as aprovacao from "@/server/aprovacao.repo";
import * as crm from "@/server/crm.repo";
import type { EstagioCrm } from "@/types/domain";
import * as reativacao from "@/server/reativacao.repo";
import * as escalonamentos from "@/server/escalonamentos.repo";
import * as prontuario from "@/server/prontuario.repo";

/**
 * As ferramentas do chat. Cada uma é um invólucro fino sobre um repo que já
 * existe — nenhuma abre caminho de dados novo, e todas herdam a RLS por tenant
 * do `withTenant` que as envolve.
 *
 * A DECISÃO QUE GOVERNA O CATÁLOGO
 * O modelo não recebe a definição de uma ferramenta que o papel não pode usar —
 * com UMA exceção deliberada: as ações `sensivel`. Uma recepcionista PRECISA
 * conseguir tentar a baixa financeira, senão não existe pedido de aprovação
 * para o dono resolver; esconder a ferramenta mataria a fila antes dela nascer.
 * Então o catálogo é: o que o papel pode + o que é sensível. A diferença entre
 * "executa" e "vira pedido" é resolvida no gate, em tempo de execução, por
 * `requireAcaoOuSolicitar` — nunca pela ausência da ferramenta.
 *
 * Filtrar o catálogo é conveniência (o modelo não é tentado, o prompt encolhe).
 * A GARANTIA continua sendo a checagem no servidor. Duas camadas, de propósito.
 */

export interface Ferramenta {
  acao: Acao;
  descricao: string;
  parametros: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  executar: (
    tx: Tx,
    args: Record<string, unknown>,
    ctx: { usuarioId: number }
  ) => Promise<unknown>;
}

const n = (v: unknown): number => {
  const x = Number(v);
  if (!Number.isFinite(x)) throw new Error(`Valor numérico inválido: ${String(v)}`);
  return x;
};

export const FERRAMENTAS: Record<string, Ferramenta> = {
  // ---------------------------------------------------------------- leitura
  consultar_estoque: {
    acao: "ver_estoque",
    descricao: "Lista o saldo atual de cada produto do estoque, com alertas de ruptura e validade.",
    parametros: { type: "object", properties: {}, required: [] },
    executar: async (tx) => ({
      niveis: await estoque.nivelPorProduto(tx),
      alertas: await estoque.listarAlertas(tx),
    }),
  },

  consultar_financeiro: {
    acao: "ver_financeiro",
    descricao:
      "Indicadores financeiros da clínica: caixa do dia e do mês, a receber, inadimplência e ticket médio.",
    parametros: { type: "object", properties: {}, required: [] },
    executar: async (tx) => financeiro.indicadores(tx),
  },

  consultar_inadimplentes: {
    acao: "ver_financeiro",
    descricao: "Lista as cobranças vencidas e não pagas.",
    parametros: { type: "object", properties: {}, required: [] },
    executar: async (tx) => financeiro.listarInadimplentes(tx),
  },

  consultar_agenda_do_dia: {
    acao: "ver_agenda",
    descricao: "Mostra os agendamentos de uma data.",
    parametros: {
      type: "object",
      properties: { data: { type: "string", description: "Data no formato AAAA-MM-DD" } },
      required: ["data"],
    },
    executar: async (tx, a) => agenda.agendaDoDia(tx, String(a.data)),
  },

  consultar_pedidos_de_aprovacao: {
    acao: "ver_solicitacoes",
    descricao: "Lista os pedidos de aprovação pendentes da clínica.",
    parametros: { type: "object", properties: {}, required: [] },
    executar: async (tx) => {
      await aprovacao.expirarVencidas(tx);
      return aprovacao.listarPendentes(tx);
    },
  },

  consultar_crm: {
    acao: "ver_crm",
    descricao:
      "Pipeline de relacionamento: pacientes por estágio (inadimplente, inativo, em tratamento, novo, ativo), com tarefas de follow-up abertas.",
    parametros: {
      type: "object",
      properties: {
        estagio: {
          type: "string",
          description: "Filtra por estágio: inadimplente, inativo, em_tratamento, novo ou ativo. Omitir para ver todos.",
        },
      },
      required: [],
    },
    executar: async (tx, a) => ({
      contagem: await crm.contarPorEstagio(tx),
      pipeline: await crm.listarPipeline(
        tx,
        a.estagio ? { estagio: a.estagio as EstagioCrm } : {}
      ),
    }),
  },

  consultar_reativacao: {
    acao: "ver_reativacao",
    descricao: "Campanha de reativação ativa e métricas da sequência (em sequência, reativados, opt-out, concluídos, elegíveis).",
    parametros: { type: "object", properties: {}, required: [] },
    executar: async (tx) => {
      const campanha = await reativacao.getCampanhaAtiva(tx);
      const janela = campanha?.janela_dias ?? 30;
      return { campanha, metricas: await reativacao.metricas(tx, janela) };
    },
  },

  consultar_escalonamento: {
    acao: "ver_escalonamento",
    descricao: "Fila de atendimento humano: itens que a SOFIA encaminhou (sintoma clínico, dúvida, reclamação, pedido explícito) e ainda não foram resolvidos.",
    parametros: { type: "object", properties: {}, required: [] },
    executar: async (tx) => escalonamentos.listarFila(tx),
  },

  consultar_auditoria: {
    acao: "ver_auditoria",
    descricao:
      "Trilha de quem acessou o prontuário: identificadores de usuário/paciente/entrada, tipo de ação e quando — nunca o conteúdo acessado.",
    parametros: { type: "object", properties: {}, required: [] },
    executar: async (tx, _a, ctx) => {
      const acessos = await prontuario.listarAcessosResumo(tx);
      // Ler a auditoria também gera entrada na auditoria (nota de demo-5c) —
      // sem paciente/entrada específicos, é evento sobre a trilha em si.
      await prontuario.registrarAcesso(tx, "leu", ctx.usuarioId, null, null);
      return acessos;
    },
  },

  // ------------------------------------------------- escrita sensível
  // Estas continuam no catálogo mesmo para quem não pode executá-las: é assim
  // que a tentativa vira pedido de aprovação em vez de beco sem saída.

  ajustar_inventario: {
    acao: "gerir_estoque",
    descricao:
      "Ajusta o saldo de um lote para a quantidade contada na conferência física (baixa ou entrada de correção).",
    parametros: {
      type: "object",
      properties: {
        loteId: { type: "number", description: "Id do lote conferido" },
        quantidadeContada: { type: "number", description: "Quantidade encontrada na contagem" },
        observacao: { type: "string", description: "Motivo do ajuste" },
      },
      required: ["loteId", "quantidadeContada"],
    },
    executar: async (tx, a, ctx) =>
      estoque.ajustarInventario(tx, {
        loteId: n(a.loteId),
        quantidadeContada: n(a.quantidadeContada),
        usuarioId: ctx.usuarioId,
        observacao: a.observacao ? String(a.observacao) : undefined,
      }),
  },

  registrar_pagamento: {
    acao: "gerir_financeiro",
    descricao: "Registra o pagamento de uma cobrança, dando baixa nela.",
    parametros: {
      type: "object",
      properties: {
        cobrancaId: { type: "number", description: "Id da cobrança" },
        formaPagamento: {
          type: "string",
          description: "Forma de pagamento: dinheiro, pix, credito, debito ou convenio",
        },
      },
      required: ["cobrancaId", "formaPagamento"],
    },
    executar: async (tx, a, ctx) =>
      financeiro.registrarPagamento(tx, {
        cobrancaId: n(a.cobrancaId),
        formaPagamento: a.formaPagamento as Parameters<
          typeof financeiro.registrarPagamento
        >[1]["formaPagamento"],
        usuarioId: ctx.usuarioId,
      }),
  },

  cancelar_cobranca: {
    acao: "gerir_financeiro",
    descricao: "Cancela uma cobrança em aberto (estorno).",
    parametros: {
      type: "object",
      properties: {
        cobrancaId: { type: "number", description: "Id da cobrança" },
        motivo: { type: "string", description: "Motivo do cancelamento" },
      },
      required: ["cobrancaId", "motivo"],
    },
    executar: async (tx, a) =>
      financeiro.cancelarCobranca(tx, n(a.cobrancaId), String(a.motivo)),
  },

  // ------------------------------------------------- agenda: escrita direta
  // Único módulo com escrita direta (não por proposta): as operações são
  // reversíveis (spec §5.2). Reaproveita agenda.repo.ts — mesmas funções que
  // o painel já usa em agenda/actions.ts sob gerir_agenda — nenhum caminho de
  // anti-overbooking novo: criarAgendamento/remarcarAgendamento já dependem
  // da constraint no_overbooking (EXCLUDE por GiST) e capturam 23P01.

  criar_agendamento: {
    acao: "gerir_agenda",
    descricao: "Marca uma nova consulta para um paciente com um profissional, em um serviço e horário.",
    parametros: {
      type: "object",
      properties: {
        pacienteId: { type: "number", description: "Id do paciente" },
        profissionalId: { type: "number", description: "Id do profissional" },
        servicoId: { type: "number", description: "Id do serviço" },
        inicio: { type: "string", description: "Início no formato ISO 8601 (ex: 2026-09-10T14:00:00-03:00)" },
      },
      required: ["pacienteId", "profissionalId", "servicoId", "inicio"],
    },
    executar: async (tx, a) =>
      agenda.criarAgendamento(tx, {
        pacienteId: n(a.pacienteId),
        profissionalId: n(a.profissionalId),
        servicoId: n(a.servicoId),
        inicio: String(a.inicio),
        overbooking: false, // furar a grade é decisão de balcão, não da SOFIA
      }),
  },

  mover_agendamento: {
    acao: "gerir_agenda",
    descricao: "Remarca um agendamento existente para um novo horário.",
    parametros: {
      type: "object",
      properties: {
        agendamentoId: { type: "number", description: "Id do agendamento" },
        novoInicio: { type: "string", description: "Novo início no formato ISO 8601" },
      },
      required: ["agendamentoId", "novoInicio"],
    },
    executar: async (tx, a) => agenda.remarcarAgendamento(tx, n(a.agendamentoId), String(a.novoInicio)),
  },

  cancelar_agendamento: {
    acao: "gerir_agenda",
    descricao: "Cancela um agendamento existente.",
    parametros: {
      type: "object",
      properties: { agendamentoId: { type: "number", description: "Id do agendamento" } },
      required: ["agendamentoId"],
    },
    executar: async (tx, a) => agenda.mudarStatus(tx, n(a.agendamentoId), "cancelada"),
  },
};

/**
 * O catálogo que o modelo enxerga, para a sessão atual.
 * Derivado da tabela `acao` (via `acoesPermitidas`), não de uma lista paralela:
 * ferramenta cujo `acao` não existe mais no banco simplesmente some daqui.
 */
export async function catalogoDaSessao(): Promise<FerramentaExposta[]> {
  const permitidas = new Set((await acoesPermitidas()).map((a) => a.chave));

  const expostas: FerramentaExposta[] = [];
  for (const [nome, f] of Object.entries(FERRAMENTAS)) {
    if (!permitidas.has(f.acao)) {
      const meta = await metaDaAcao(f.acao);
      if (!meta?.sensivel) continue; // não pode e não é sensível: nem aparece
    }
    expostas.push({
      type: "function",
      function: { name: nome, description: f.descricao, parameters: f.parametros },
    });
  }
  return expostas;
}
