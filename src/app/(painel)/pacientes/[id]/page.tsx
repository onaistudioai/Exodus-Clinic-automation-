import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as pacientes from "@/server/pacientes.repo";
import * as prontuario from "@/server/prontuario.repo";
import { listarVinculosDoPaciente, NIVEIS_AUTORIZACAO } from "@/server/identidade.repo";
import { definirNivelAction } from "./vinculos-actions";

const ROTULO_NIVEL: Record<string, string> = {
  nenhum: "nenhum",
  agendar: "agendar",
  agendar_e_consultar: "agendar e consultar",
  total: "total",
};

function fmtData(iso: string | null): string {
  if (!iso) return "—";
  const [data] = iso.split("T");
  const [a, m, d] = data.split("-");
  return `${d}/${m}/${a}`;
}

/**
 * Ficha do paciente p/ a RECEPÇÃO (gate `checkin` = recepção/admin). Mostra dados
 * cadastrais + ETIQUETAS estruturadas do prontuário (tipo de atendimento, retorno,
 * estado) — NUNCA o texto clínico (decisão §0.4). O conteúdo clínico é só de médico/admin.
 */
export default async function FichaPacientePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAcao("checkin");
  const session = await verifySession();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const dados = await withTenantReadOnly(session.clinica_id, async (tx) => {
    const paciente = await pacientes.obterPorId(tx, id);
    if (!paciente) return null;
    const etiquetas = await prontuario.listarEtiquetas(tx, id);
    const vinculos = await listarVinculosDoPaciente(tx, id);
    return { paciente, etiquetas, vinculos };
  });
  if (!dados) notFound();

  const p = dados.paciente;

  return (
    <div className="max-w-2xl space-y-6">
      <Link href="/checkin" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← voltar ao check-in
      </Link>

      <div className="rounded-2xl bg-white p-5 ring-1 ring-black/5">
        <div className="flex items-center gap-2 text-xl font-semibold">
          {p.nome_completo}
          <span className="text-sm font-normal text-neutral-500">{p.idade} anos</span>
          {p.e_menor && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
              ⚠ menor
            </span>
          )}
        </div>
        <div className="mt-1 text-sm text-neutral-500">
          nasc. {fmtData(p.data_nascimento)} ·{" "}
          {p.cpf_last4 ? `CPF …-${p.cpf_last4}` : "(sem CPF)"}
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-neutral-500">
          Atendimentos ({dados.etiquetas.length})
        </h2>
        <p className="text-xs text-neutral-400">
          A recepção vê só as etiquetas (tipo, retorno) — o conteúdo clínico é restrito a
          médico/admin.
        </p>
        {dados.etiquetas.length === 0 ? (
          <p className="text-sm text-neutral-500">Nenhum atendimento registrado.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-white ring-1 ring-black/5">
            {dados.etiquetas.map((e) => (
              <li key={e.id} className="flex items-center justify-between p-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">
                    {e.estado}
                  </span>
                  {e.tipo_atendimento && (
                    <span className="text-neutral-700">{e.tipo_atendimento}</span>
                  )}
                  {e.precisa_retorno && (
                    <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">
                      retorno marcado
                    </span>
                  )}
                </div>
                <span className="text-xs text-neutral-400">{fmtData(e.criado_em)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-neutral-500">
          Vínculos WhatsApp ({dados.vinculos.length})
        </h2>
        <p className="text-xs text-neutral-400">
          Nível controla o que a SOFIA faz em nome deste número por este paciente. O vínculo
          titular já vem com &quot;agendar e consultar&quot; (é o próprio dado dele); outros
          vínculos só ganham nível por esta ação — nunca por autoatendimento no WhatsApp.
        </p>
        {dados.vinculos.length === 0 ? (
          <p className="text-sm text-neutral-500">Nenhum contato WhatsApp vinculado.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-white ring-1 ring-black/5">
            {dados.vinculos.map((v) => (
              <li key={v.contatoId} className="flex items-center justify-between gap-3 p-4 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium">
                      {v.papel}
                    </span>
                    <span className="truncate text-neutral-700">{v.telefone ?? v.chatId}</span>
                  </div>
                  <p className="mt-1 text-xs text-neutral-400">nível atual: {ROTULO_NIVEL[v.nivel]}</p>
                </div>
                <form action={definirNivelAction} className="flex shrink-0 items-center gap-2">
                  <input type="hidden" name="contatoId" value={v.contatoId} />
                  <input type="hidden" name="pacienteId" value={p.id} />
                  <select
                    name="nivel"
                    defaultValue={v.nivel}
                    className="rounded-lg px-2 py-1 text-xs ring-1 ring-neutral-300"
                  >
                    {NIVEIS_AUTORIZACAO.map((n) => (
                      <option key={n} value={n}>
                        {ROTULO_NIVEL[n]}
                      </option>
                    ))}
                  </select>
                  <button className="rounded-lg bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white">
                    Salvar
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
