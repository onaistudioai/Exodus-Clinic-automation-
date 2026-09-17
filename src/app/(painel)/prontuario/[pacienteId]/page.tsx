import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenant } from "@/lib/tenant";
import * as pacientes from "@/server/pacientes.repo";
import * as prontuario from "@/server/prontuario.repo";
import * as agendamentos from "@/server/agendamentos.repo";
import ProntuarioPaciente from "./ProntuarioPaciente";

export default async function ProntuarioPacientePage({
  params,
}: {
  params: Promise<{ pacienteId: string }>;
}) {
  await requireAcao("ler_texto_clinico");
  const session = await verifySession();
  const pacienteId = Number((await params).pacienteId);
  if (!Number.isInteger(pacienteId) || pacienteId <= 0) notFound();

  // Tudo em UMA transação (mesmo tenant): carrega + registra a LEITURA na auditoria.
  const dados = await withTenant(session.clinica_id, async (tx) => {
    const paciente = await pacientes.obterPorId(tx, pacienteId);
    if (!paciente) return null;
    const entradas = await prontuario.listarPorPaciente(tx, pacienteId);
    const ags = await agendamentos.listarVinculaveis(tx, pacienteId);
    await prontuario.registrarAcesso(
      tx,
      "leu",
      session.usuario_id,
      pacienteId,
      null,
      "abriu prontuário"
    );
    return { paciente, entradas, ags };
  });
  if (!dados) notFound();

  // Só médico escreve (criar_entrada_prontuario); admin lê mas não cria.
  const podeEscrever = session.papel === "medico";

  return (
    <div className="max-w-2xl space-y-6">
      <Link href="/prontuario" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← voltar à busca
      </Link>
      <ProntuarioPaciente
        paciente={dados.paciente}
        entradas={dados.entradas}
        agendamentos={dados.ags}
        podeEscrever={podeEscrever}
      />
    </div>
  );
}
