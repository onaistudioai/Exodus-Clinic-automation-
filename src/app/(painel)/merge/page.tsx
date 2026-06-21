import { requireAcao } from "@/lib/rbac";
import MergePacientes from "./MergePacientes";

export default async function MergePage() {
  // RBAC server-side: só recepcao/admin (mesma ação do check-in). Lança se não autorizado.
  await requireAcao("checkin");

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-2xl font-semibold">Mesclar pacientes</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Una duas fichas duplicadas da mesma pessoa. Fora do fluxo de check-in, por segurança.
      </p>
      <MergePacientes />
    </div>
  );
}
