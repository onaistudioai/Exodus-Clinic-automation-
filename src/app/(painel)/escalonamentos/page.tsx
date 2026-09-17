import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as escalonamentos from "@/server/escalonamentos.repo";
import { assumirAction, resolverAction, reconfirmarContatoAction } from "./actions";

const ROTULO: Record<string, string> = {
  sintoma_clinico: "sintoma",
  duvida_clinica: "dúvida clínica",
  midia_para_avaliacao: "mídia",
  reclamacao: "reclamação",
  pediu_humano: "pediu humano",
  nao_compreendido: "não compreendido",
  fora_de_escopo: "fora de escopo",
  reconfirmar_identidade: "reconfirmar contato",
};

function espera(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h}h${String(min % 60).padStart(2, "0")}`;
}

export default async function EscalonamentosPage() {
  await requireAcao("ver_escalonamento");
  const session = await verifySession();

  const fila = await withTenantReadOnly(session.clinica_id, (tx) =>
    escalonamentos.listarFila(tx)
  );

  const atrasados = fila.filter((i) => i.atrasado).length;

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold">Escalonamentos</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Conversas em que a automação parou e chamou a equipe. Enquanto o item estiver
        aberto, o bot não responde àquele número.
        {atrasados > 0 && (
          <span className="ml-1 font-medium text-red-600">
            {atrasados} fora do prazo.
          </span>
        )}
      </p>

      {fila.length === 0 ? (
        <p className="text-sm text-neutral-500">Fila vazia — nada esperando atendimento.</p>
      ) : (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-white ring-1 ring-black/5">
          {fila.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-4 p-3 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium">
                    {ROTULO[i.gatilho] ?? i.gatilho}
                  </span>
                  <span className="text-neutral-700">{i.chat_id}</span>
                  <span
                    className={
                      i.atrasado ? "text-xs font-medium text-red-600" : "text-xs text-neutral-400"
                    }
                  >
                    {espera(i.esperando_min)}
                    {i.atrasado && " · fora do prazo"}
                  </span>
                </div>
                {i.trecho && (
                  <p className="mt-1 truncate text-neutral-500">&ldquo;{i.trecho}&rdquo;</p>
                )}
              </div>

              <div className="flex shrink-0 gap-2">
                {i.status === "aberto" && (
                  <form action={assumirAction}>
                    <input type="hidden" name="id" value={i.id} />
                    <button className="rounded-lg bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white">
                      Assumir
                    </button>
                  </form>
                )}
                {i.gatilho === "reconfirmar_identidade" ? (
                  // Único caminho de volta (W2e): confirma a pessoa
                  // presencialmente E carimba o contato — "Resolver" sozinho
                  // deixaria o número preso mesmo fora da fila.
                  <form action={reconfirmarContatoAction}>
                    <input type="hidden" name="id" value={i.id} />
                    <input type="hidden" name="chatId" value={i.chat_id} />
                    <button className="rounded-lg px-2.5 py-1 text-xs font-medium ring-1 ring-neutral-300">
                      Confirmei presencialmente
                    </button>
                  </form>
                ) : (
                  <form action={resolverAction}>
                    <input type="hidden" name="id" value={i.id} />
                    <button className="rounded-lg px-2.5 py-1 text-xs font-medium ring-1 ring-neutral-300">
                      Resolver
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
