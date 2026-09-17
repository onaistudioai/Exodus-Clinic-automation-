import "server-only";
import { verifySession } from "@/lib/dal";
import { permissoes, metaDaAcao, type Acao } from "@/lib/rbac";
import { withTenant } from "@/lib/tenant";
import * as aprovacao from "@/server/aprovacao.repo";

/**
 * O gate que NÃO encerra na negação.
 *
 * `requireAcao` responde sim ou lança. Para as ações marcadas `sensivel` isso é
 * pouco: uma recepcionista que precisa dar baixa numa cobrança às 19h não tem o
 * que fazer com um erro — a informação de QUE baixa ela ia dar se perde, e ela
 * refaz tudo amanhã na frente do dono. Aqui a tentativa vira registro: os
 * argumentos exatos ficam guardados e o dono executa aquilo, não uma memória.
 *
 * O QUE ISTO NÃO É: um caminho para a ação acontecer sem permissão. A execução
 * do efeito é feita depois, por quem aprova, sob a autorização de quem aprova.
 * Ver `executarAprovada` — é lá que a distinção vira código.
 */

export type ResultadoAcao =
  | { permitido: true }
  | { permitido: false; solicitacaoId: number; acao: Acao };

/**
 * Autoriza, ou abre um pedido de aprovação e devolve o número dele.
 *
 * Lança (como `requireAcao`) quando a ação negada NÃO é sensível: pedir
 * aprovação para ler texto clínico não faria sentido — a restrição ali é o
 * ponto, não um obstáculo operacional.
 */
export async function requireAcaoOuSolicitar(
  acao: Acao,
  argumentos: Record<string, unknown>,
  justificativa?: string
): Promise<ResultadoAcao> {
  const { papel, pode } = await permissoes();
  if (pode(acao)) return { permitido: true };

  const meta = await metaDaAcao(acao);
  if (!meta?.sensivel) {
    throw new Error(`Acesso negado: papel '${papel}' não pode '${acao}'.`);
  }

  const session = await verifySession();
  const solicitacaoId = await withTenant(session.clinica_id, (tx) =>
    aprovacao.abrir(tx, session.clinica_id, {
      acao,
      solicitanteId: session.usuario_id,
      argumentos,
      justificativa,
    })
  );

  return { permitido: false, solicitacaoId, acao };
}

/**
 * Executa o efeito de um pedido aprovado.
 *
 * A REGRA QUE SUSTENTA A FILA INTEIRA: quem chama isto precisa poder fazer a
 * ação. `requireAcao(pedido.acao)` roda contra a sessão do APROVADOR — se ele
 * também não puder, nada acontece. Sem essa linha, a fila viraria um caminho de
 * escalada de privilégio: bastaria pedir para conseguir, que é exatamente o
 * buraco que o seguranca/004+007 fechou no banco.
 *
 * O efeito em si é injetado pelo chamador (`efeito`), porque cada ação tem sua
 * server action. Isto aqui é só a moldura: travar, autorizar, executar, fechar
 * — tudo na MESMA transação, para que uma falha no efeito não deixe o pedido
 * marcado como aprovado sem ter acontecido.
 */
export async function executarAprovada<T>(
  solicitacaoId: number,
  efeito: (
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    acao: Acao,
    argumentos: Record<string, unknown>
  ) => Promise<T>
): Promise<T> {
  const session = await verifySession();
  const { pode } = await permissoes();

  if (!pode("aprovar_solicitacao")) {
    throw new Error(`Acesso negado: papel '${session.papel}' não pode 'aprovar_solicitacao'.`);
  }

  return withTenant(session.clinica_id, async (tx) => {
    const pedido = await aprovacao.travarParaDecisao(tx, solicitacaoId);
    if (!pedido) {
      throw new Error(
        `Pedido #${solicitacaoId} não está mais pendente (já decidido, vencido ou inexistente).`
      );
    }

    // O aprovador precisa poder fazer a ação, não apenas aprovar pedidos.
    if (!pode(pedido.acao)) {
      throw new Error(
        `Acesso negado: papel '${session.papel}' aprova pedidos, mas não pode '${pedido.acao}'.`
      );
    }

    const resultado = await efeito(tx, pedido.acao, pedido.argumentos);
    await aprovacao.decidir(tx, solicitacaoId, "aprovada", session.usuario_id);
    return resultado;
  });
}

/** Nega um pedido. Sem efeito, mas fecha o ciclo e sai da fila. */
export async function negarSolicitacao(solicitacaoId: number): Promise<void> {
  const session = await verifySession();
  const { pode } = await permissoes();
  if (!pode("aprovar_solicitacao")) {
    throw new Error(`Acesso negado: papel '${session.papel}' não pode 'aprovar_solicitacao'.`);
  }
  await withTenant(session.clinica_id, (tx) =>
    aprovacao.decidir(tx, solicitacaoId, "negada", session.usuario_id)
  );
}
