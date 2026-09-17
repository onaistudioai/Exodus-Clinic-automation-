import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as prontuario from "@/server/prontuario.repo";

const ROTULO: Record<string, string> = {
  leu: "leu",
  criou: "criou",
  finalizou: "finalizou",
  corrigiu: "corrigiu",
  expurgou: "expurgou",
};

function fmt(iso: string): string {
  const [data, hora] = iso.split("T");
  const [a, m, d] = data.split("-");
  return `${d}/${m}/${a} ${hora?.slice(0, 5) ?? ""}`;
}

export default async function AuditoriaPage() {
  // Só admin (DRAFT §0.4).
  await requireAcao("ver_auditoria");
  const session = await verifySession();

  const acessos = await withTenantReadOnly(session.clinica_id, (tx) =>
    prontuario.listarAcessos(tx, 100)
  );

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold">Auditoria</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Trilha de acessos ao prontuário (últimos {acessos.length}). Toda leitura/escrita
        clínica é registrada — não é editável.
      </p>

      {acessos.length === 0 ? (
        <p className="text-sm text-neutral-500">Nenhum acesso registrado ainda.</p>
      ) : (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-white ring-1 ring-black/5">
          {acessos.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-4 p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium">
                  {ROTULO[a.acao] ?? a.acao}
                </span>
                <span className="text-neutral-700">
                  {a.usuario_nome ?? "—"}
                  {a.usuario_papel && (
                    <span className="text-neutral-400"> ({a.usuario_papel})</span>
                  )}
                </span>
                <span className="text-neutral-400">→</span>
                <span className="text-neutral-700">
                  {a.paciente_nome ?? (a.paciente_id ? `#${a.paciente_id}` : "—")}
                </span>
                {a.entrada_id && (
                  <span className="text-neutral-400">entrada #{a.entrada_id}</span>
                )}
                {a.detalhe && <span className="text-neutral-400">· {a.detalhe}</span>}
              </div>
              <span className="shrink-0 text-xs text-neutral-400">{fmt(a.criado_em)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
