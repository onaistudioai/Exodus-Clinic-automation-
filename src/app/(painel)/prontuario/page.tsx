import { requireAcao } from "@/lib/rbac";
import BuscaProntuario from "./BuscaProntuario";

export default async function ProntuarioIndexPage() {
  // Só médico/admin leem texto clínico (DRAFT §0.4).
  await requireAcao("ler_texto_clinico");

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-2xl font-semibold">Prontuário</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Busque o paciente para ver o histórico clínico e registrar o atendimento.
      </p>
      <BuscaProntuario />
    </div>
  );
}
