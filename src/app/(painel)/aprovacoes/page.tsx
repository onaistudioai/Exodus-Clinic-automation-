import Link from "next/link";
import { requireAcao, permissoes } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenant } from "@/lib/tenant";
import * as aprovacao from "@/server/aprovacao.repo";
import * as solicitacaoPaciente from "@/server/solicitacao-paciente.repo";
import type { MotivoSolicitacao } from "@/server/solicitacao-paciente.repo";
import { PageHeader, Badge, Button, EmptyState, Card } from "@/components/ui";
import {
  aprovarAction,
  negarAction,
  tratarPacienteAction,
  negarPacienteAction,
} from "./actions";

/**
 * O que cada motivo significa para quem vai decidir. O enum vem do banco; a
 * frase é de tela — quem está no balcão precisa saber o que FAZER, não o nome
 * técnico da situação.
 */
const MOTIVO: Record<MotivoSolicitacao, { titulo: string; oQueFazer: string }> = {
  menor_sem_autoatendimento: {
    titulo: "Paciente menor de idade",
    oQueFazer:
      "A SOFIA não atende menor por chat. Fale com o responsável legal e resolva no balcão.",
  },
  nivel_insuficiente: {
    titulo: "Sem autorização para o que pediu",
    oQueFazer:
      "Se for legítimo, conceda o nível na ficha do paciente (seção Vínculos WhatsApp). Não é concedido por aqui, de propósito.",
  },
  responsavel_sem_vinculo: {
    titulo: "Alegou ser responsável, sem vínculo cadastrado",
    oQueFazer:
      "Confirme o parentesco presencialmente antes de criar o vínculo. Alegação por chat não é prova.",
  },
};

/**
 * A fila de aprovação. Sem esta tela o ciclo da Etapa 3 não fecha: o pedido
 * nasce no chat e não teria onde ser decidido.
 *
 * Quem pode aprovar vê a fila da clínica; quem não pode vê os próprios pedidos
 * e em que pé estão. As duas leituras usam a MESMA página porque a pergunta é a
 * mesma ("o que está pendente e o que aconteceu com o que eu pedi") — só muda o
 * escopo, e o escopo já é decidido pela permissão.
 */
export default async function AprovacoesPage() {
  await requireAcao("ver_solicitacoes");
  const session = await verifySession();
  const { pode } = await permissoes();
  const podeDecidir = pode("aprovar_solicitacao");

  const { fila, minhas, doWhatsapp } = await withTenant(session.clinica_id, async (tx) => {
    // A expiração é varrida na leitura: um pedido de 48h atrás não deve ser
    // aprovado hoje por engano — o estoque e o caixa já são outros.
    await aprovacao.expirarVencidas(tx);
    return {
      fila: podeDecidir ? await aprovacao.listarPendentes(tx) : [],
      minhas: await aprovacao.listarMinhas(tx, session.usuario_id),
      // Pedidos vindos do WhatsApp. A própria consulta já exclui vencidos, então
      // não há varredura a fazer aqui.
      doWhatsapp: podeDecidir ? await solicitacaoPaciente.listarPendentes(tx) : [],
    };
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <PageHeader
        title="Aprovações"
        subtitle={
          podeDecidir
            ? "Pedidos aguardando sua decisão. Aprovar executa a ação; negar encerra o pedido."
            : "Seus pedidos e em que pé cada um está."
        }
      />

      {podeDecidir && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold text-ink-500">
            Aguardando decisão ({fila.length})
          </h2>
          {fila.length === 0 ? (
            <EmptyState>Nada pendente.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {fila.map((s) => (
                <li key={s.id}>
                  <Card>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-900">
                          #{s.id} · {s.acao_descricao}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-500">
                          Pedido por {s.solicitante_nome} ·{" "}
                          {new Date(s.criado_em).toLocaleString("pt-BR")}
                        </p>
                        {s.justificativa && (
                          <p className="mt-1.5 text-sm text-ink-700">“{s.justificativa}”</p>
                        )}
                        {/* Os argumentos exatos, para a decisão ser sobre o que
                            de fato vai acontecer — não sobre uma paráfrase. */}
                        <pre className="mt-2 overflow-x-auto rounded-lg bg-neutral-50 p-2 text-xs text-neutral-700">
                          {JSON.stringify(s.argumentos, null, 2)}
                        </pre>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <form action={aprovarAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <Button type="submit">Aprovar e executar</Button>
                        </form>
                        <form action={negarAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <Button type="submit" variant="ghost">
                            Negar
                          </Button>
                        </form>
                      </div>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {podeDecidir && (
        <section className="mb-10">
          <h2 className="mb-1 text-sm font-semibold text-ink-500">
            Vindos do WhatsApp ({doWhatsapp.length})
          </h2>
          {/* A frase existe porque o botão parece prometer mais do que faz.
              Sem ela, "Aprovar" ao lado de um pedido de menor de idade sugere
              que o sistema vai liberar alguma coisa — e não vai. */}
          <p className="mb-3 text-xs text-ink-500">
            Decidir aqui só registra o desfecho. Nada é executado nem liberado
            automaticamente — o atendimento acontece no balcão.
          </p>
          {doWhatsapp.length === 0 ? (
            <EmptyState>Nenhum pedido do WhatsApp aguardando.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {doWhatsapp.map((s) => (
                <li key={s.id}>
                  <Card>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-900">
                          #{s.id} · {MOTIVO[s.motivo].titulo}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-500">
                          {/* pacienteNome é null quando o número não resolveu
                              paciente nenhum — mostrar o chat_id é o único
                              identificador honesto nesse caso. */}
                          {s.pacienteNome ?? `Contato ${s.chatId}`} ·{" "}
                          {new Date(s.criadoEm).toLocaleString("pt-BR")}
                        </p>
                        <p className="mt-1.5 text-sm text-ink-700">
                          {MOTIVO[s.motivo].oQueFazer}
                        </p>
                        {s.pacienteId && (
                          <Link
                            href={`/pacientes/${s.pacienteId}`}
                            className="mt-1.5 inline-block text-xs underline"
                          >
                            Abrir ficha do paciente
                          </Link>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <form action={tratarPacienteAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <Button type="submit">Tratei este pedido</Button>
                        </form>
                        <form action={negarPacienteAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <Button type="submit" variant="ghost">
                            Negar
                          </Button>
                        </form>
                      </div>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink-500">Seus pedidos</h2>
        {minhas.length === 0 ? (
          <EmptyState>Você ainda não pediu nenhuma aprovação.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {minhas.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-black/5 px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate">
                  #{s.id} · {s.acao_descricao}
                </span>
                <Badge tone={
                    s.estado === "aprovada"
                      ? "positive"
                      : s.estado === "negada"
                        ? "negative"
                        : s.estado === "expirada"
                          ? "warning"
                          : "neutral"
                  }>
                  {s.estado_rotulo}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
