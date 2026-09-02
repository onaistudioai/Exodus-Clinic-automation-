"use server";

import { revalidatePath } from "next/cache";
import { executarAprovada, negarSolicitacao } from "@/lib/rbac-aprovacao";
import { executarAprovadaPaciente, negarSolicitacaoPaciente } from "@/lib/aprovacao-paciente";
import { FERRAMENTAS } from "@/lib/chat-ferramentas";
import { verifySession } from "@/lib/dal";

/**
 * As duas decisões que fecham o ciclo do pedido de aprovação.
 *
 * O EFEITO É O MESMO CÓDIGO que o chat executaria se quem pediu tivesse
 * permissão: as ferramentas de `chat-ferramentas.ts`, chamadas com os
 * argumentos guardados no pedido. Reimplementar a baixa aqui criaria dois
 * caminhos para o mesmo fato — e o segundo caminho é sempre o que esquece uma
 * validação.
 */

function idDe(formData: FormData): number {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("Pedido inválido.");
  return id;
}

export async function aprovarAction(formData: FormData): Promise<void> {
  const id = idDe(formData);
  const session = await verifySession();

  await executarAprovada(id, async (tx, acao, argumentos) => {
    // A ferramenta é encontrada pela AÇÃO, não pelo nome que o chat usou: o
    // pedido guarda `acao_chave`, que é a chave estrangeira real. Se a
    // ferramenta que originou o pedido for renomeada ou removida, o pedido
    // continua executável enquanto a ação existir.
    const ferramenta = Object.values(FERRAMENTAS).find((f) => f.acao === acao);
    if (!ferramenta) {
      throw new Error(`Nenhuma ferramenta implementa a ação '${acao}'.`);
    }
    // usuarioId é o do APROVADOR, não o de quem pediu. A trilha de auditoria
    // precisa registrar quem de fato autorizou a baixa — quem pediu está no
    // pedido, e os dois juntos contam a história inteira.
    return ferramenta.executar(tx, argumentos, { usuarioId: session.usuario_id });
  });

  revalidatePath("/aprovacoes");
}

export async function negarAction(formData: FormData): Promise<void> {
  await negarSolicitacao(idDe(formData));
  revalidatePath("/aprovacoes");
}

/**
 * Pedido vindo do WhatsApp (solicitacao_paciente). Fecha o ciclo SEM efeito
 * automático — e isso é a decisão, não uma lacuna.
 *
 * Nos pedidos de funcionário (aprovarAction, acima) existe uma ação do catálogo
 * e argumentos guardados: aprovar É executar aquilo. Aqui o `motivo` não é uma
 * ação, é uma SITUAÇÃO (menor sem autoatendimento, nível insuficiente,
 * responsável sem vínculo). Cada uma se resolve no mundo real — ligar para a
 * pessoa, conferir documento no balcão, conceder nível na ficha do paciente —
 * e nenhuma delas deve acontecer por clique numa fila:
 *
 *   - conceder nível daqui contornaria a regra que sustenta o modelo inteiro
 *     (nível só sobe por ato humano deliberado na ficha, nunca por um pedido
 *     que a própria pessoa abriu do outro lado do WhatsApp);
 *   - agir automaticamente sobre paciente menor é exatamente o que a política
 *     "a Sofia PROPÕE, o balcão DISPÕE" existe para impedir.
 *
 * Então aprovar aqui registra "eu tratei isto", e o efeito real é o trabalho
 * humano que o recepcionista já fez antes de clicar. O efeito injetado é vazio
 * de propósito — a moldura de executarAprovadaPaciente continua valendo (trava
 * a linha, exige `aprovar_solicitacao`, fecha na mesma transação).
 */
export async function tratarPacienteAction(formData: FormData): Promise<void> {
  await executarAprovadaPaciente(idDe(formData), async () => undefined);
  revalidatePath("/aprovacoes");
}

export async function negarPacienteAction(formData: FormData): Promise<void> {
  await negarSolicitacaoPaciente(idDe(formData));
  revalidatePath("/aprovacoes");
}
