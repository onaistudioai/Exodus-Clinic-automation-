import { requireAcao, acoesPermitidas, permissoes } from "@/lib/rbac";
import Chat from "./Chat";

/**
 * O chat é a porta única para os módulos. O que muda entre papéis não é a tela,
 * é o CATÁLOGO — e ele é montado no servidor, a partir de papel_acao.
 *
 * A lista de capacidades mostrada abaixo não é decorativa: sem ela a pessoa
 * descobre o próprio limite errando. Mostrar o que dá para pedir é mais honesto
 * do que deixar o modelo recusar depois.
 */
export default async function ChatPage() {
  await requireAcao("usar_chat");
  const { papel } = await permissoes();
  const acoes = await acoesPermitidas();

  const capacidades = acoes
    .filter((a) => a.modulo !== "acesso" && a.modulo !== "chat")
    .map((a) => ({ descricao: a.descricao, escrita: a.escrita }));

  return <Chat papel={papel} capacidades={capacidades} />;
}
