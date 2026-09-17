import "server-only";
import { verifySession } from "@/lib/dal";
import { permissoes } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import * as solicitacao from "@/server/solicitacao-paciente.repo";
import type { MotivoSolicitacao } from "@/server/solicitacao-paciente.repo";

/**
 * Executor de pedidos vindos do WhatsApp (W2g) — mesma moldura de
 * src/lib/rbac-aprovacao.ts::executarAprovada, aplicada a solicitacao_paciente
 * em vez de solicitacao_aprovacao. A REGRA QUE SUSTENTA A FILA É A MESMA:
 * quem decide precisa poder "aprovar_solicitacao" (mesma ação do módulo
 * acesso — não duplica a permissão, reusa), e o efeito roda sob a
 * autorização de quem aprova, na MESMA transação que fecha o pedido.
 *
 * Diferente de executarAprovada: aqui não há `pode(pedido.acao)` a checar
 * contra o aprovador, porque o "pedido" não é uma ação do catálogo `acao` —
 * é uma situação (menor, nível insuficiente, responsável sem vínculo) que só
 * humano decide; não existe uma permissão de sistema equivalente para
 * comparar.
 */

export async function listarPendentes() {
  const session = await verifySession();
  return withTenant(session.clinica_id, (tx) => solicitacao.listarPendentes(tx));
}

export async function executarAprovadaPaciente<T>(
  solicitacaoId: number,
  efeito: (
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    motivo: MotivoSolicitacao,
    pacienteId: number | null,
    argumentos: Record<string, unknown>
  ) => Promise<T>
): Promise<T> {
  const session = await verifySession();
  const { pode } = await permissoes();

  if (!pode("aprovar_solicitacao")) {
    throw new Error(`Acesso negado: papel '${session.papel}' não pode 'aprovar_solicitacao'.`);
  }

  return withTenant(session.clinica_id, async (tx) => {
    const pedido = await solicitacao.travarParaDecisao(tx, solicitacaoId);
    if (!pedido) {
      throw new Error(
        `Pedido #${solicitacaoId} não está mais pendente (já decidido, vencido ou inexistente).`
      );
    }

    const resultado = await efeito(tx, pedido.motivo, pedido.pacienteId, pedido.argumentos);
    await solicitacao.decidir(tx, solicitacaoId, "aprovada", session.usuario_id);
    return resultado;
  });
}

/** Nega um pedido. Sem efeito, mas fecha o ciclo e sai da fila. */
export async function negarSolicitacaoPaciente(solicitacaoId: number): Promise<void> {
  const session = await verifySession();
  const { pode } = await permissoes();
  if (!pode("aprovar_solicitacao")) {
    throw new Error(`Acesso negado: papel '${session.papel}' não pode 'aprovar_solicitacao'.`);
  }
  await withTenant(session.clinica_id, (tx) =>
    solicitacao.decidir(tx, solicitacaoId, "negada", session.usuario_id)
  );
}
