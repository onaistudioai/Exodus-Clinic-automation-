import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { permissoes } from "@/lib/rbac";
import { requireAcaoOuSolicitar } from "@/lib/rbac-aprovacao";
import { withTenant } from "@/lib/tenant";
import { chamarLLM, type Mensagem } from "@/lib/llm";
import { FERRAMENTAS, catalogoDaSessao } from "@/lib/chat-ferramentas";
import { registrarChamada } from "@/server/chat-chamadas.repo";

/**
 * O chat do painel. Porta única para os módulos, com o papel decidindo o que dá
 * para ver e o que dá para fazer.
 *
 * O LAÇO: modelo -> ferramentas -> resultado -> modelo, até ele responder em
 * texto. `MAX_VOLTAS` existe porque um modelo pode se enroscar chamando a mesma
 * ferramenta indefinidamente, e cada volta é uma chamada paga e um request
 * segurado.
 *
 * ONDE ESTÁ A AUTORIZAÇÃO: em `requireAcaoOuSolicitar`, por chamada de
 * ferramenta. Não no prompt. Um modelo persuadido a chamar `registrar_pagamento`
 * ainda bate no gate — instrução em linguagem natural não é controle de acesso.
 */

const MAX_VOLTAS = 5;

function promptDeSistema(rotuloPapel: string): string {
  return [
    "Você é a assistente interna do painel da clínica. Responda em português do Brasil, de forma curta e direta.",
    `Quem está falando com você tem o papel: ${rotuloPapel}.`,
    "Use as ferramentas para consultar dados reais. Nunca invente números, saldos ou valores: se não tiver a informação, diga que não tem.",
    "Antes de executar qualquer ação que altere dados, confirme com a pessoa o que exatamente será feito.",
    "Se uma ação retornar que virou pedido de aprovação, explique com clareza que ela NÃO foi executada e informe o número do pedido.",
  ].join(" ");
}

export async function POST(req: Request) {
  const session = await verifySession();
  const { papel } = await permissoes();

  const { mensagens } = (await req.json()) as { mensagens: Mensagem[] };
  if (!Array.isArray(mensagens) || mensagens.length === 0) {
    return NextResponse.json({ erro: "Nenhuma mensagem enviada." }, { status: 400 });
  }

  const ferramentas = await catalogoDaSessao();
  const historico: Mensagem[] = [
    { role: "system", content: promptDeSistema(papel) },
    // Só role e content do cliente: `tool_calls` vindo do navegador deixaria
    // alguém forjar um resultado de ferramenta que nunca foi executada.
    ...mensagens.map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: String(m.content ?? ""),
    })),
  ];

  const pedidosCriados: { id: number; acao: string }[] = [];

  for (let volta = 0; volta < MAX_VOLTAS; volta++) {
    const resposta = await chamarLLM(historico, ferramentas);

    if (resposta.tool_calls.length === 0) {
      return NextResponse.json({
        resposta: resposta.content ?? "",
        pedidosCriados,
      });
    }

    historico.push({
      role: "assistant",
      content: resposta.content,
      tool_calls: resposta.tool_calls,
    });

    for (const chamada of resposta.tool_calls) {
      const ferramenta = FERRAMENTAS[chamada.function.name];
      let resultado: unknown;

      if (!ferramenta) {
        resultado = { erro: `Ferramenta desconhecida: ${chamada.function.name}` };
      } else {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(chamada.function.arguments || "{}");
        } catch {
          // Argumento malformado do modelo é erro dele, não do usuário: devolve
          // para ele corrigir na próxima volta em vez de derrubar o request.
          resultado = { erro: "Argumentos inválidos." };
        }

        if (resultado === undefined) {
          try {
            const gate = await requireAcaoOuSolicitar(ferramenta.acao, args);

            if (gate.permitido) {
              // Trilha da Parte F: negado grava tanto quanto sucesso, então o
              // registro entra na MESMA transação da execução — se a
              // ferramenta falhar, o rollback também desfaz o log, e o catch
              // abaixo registra 'erro' numa tx própria.
              resultado = await withTenant(session.clinica_id, async (tx) => {
                const r = await ferramenta.executar(tx, args, { usuarioId: session.usuario_id });
                await registrarChamada(tx, chamada.function.name, ferramenta.acao, "sucesso", session.usuario_id);
                return r;
              });
            } else {
              pedidosCriados.push({ id: gate.solicitacaoId, acao: gate.acao });
              resultado = {
                executado: false,
                pedido_de_aprovacao: gate.solicitacaoId,
                aviso:
                  "Ação NÃO executada: seu papel não tem essa permissão. Foi aberto um pedido de aprovação para o dono da clínica.",
              };
              await withTenant(session.clinica_id, (tx) =>
                registrarChamada(tx, chamada.function.name, ferramenta.acao, "negado", session.usuario_id)
              );
            }
          } catch (e) {
            resultado = { erro: e instanceof Error ? e.message : "Falha ao executar." };
            await withTenant(session.clinica_id, (tx) =>
              registrarChamada(tx, chamada.function.name, ferramenta.acao, "erro", session.usuario_id)
            ).catch(() => {}); // a trilha não pode ser o motivo de uma resposta quebrar
          }
        }
      }

      historico.push({
        role: "tool",
        tool_call_id: chamada.id,
        content: JSON.stringify(resultado),
      });
    }
  }

  return NextResponse.json({
    resposta:
      "Não consegui concluir: a consulta deu voltas demais. Tente reformular de forma mais específica.",
    pedidosCriados,
  });
}
