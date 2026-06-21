import { requireAcao } from "@/lib/rbac";
import BuscaPaciente from "./BuscaPaciente";

export default async function CheckinPage() {
  // RBAC server-side: só recepcao/admin (DRAFT §0.4). Lança se não autorizado.
  await requireAcao("checkin");

  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-2xl font-semibold">Check-in</h1>
      <BuscaPaciente />
    </div>
  );
}
