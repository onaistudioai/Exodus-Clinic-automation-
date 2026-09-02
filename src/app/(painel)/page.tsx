import { verifySession } from "@/lib/dal";
import { permissoes } from "@/lib/rbac";
import { MODULOS } from "./modulos";
import DashboardShowcase from "./DashboardShowcase";

export default async function HomePage() {
  const session = await verifySession();
  const { pode } = await permissoes();
  const disponiveis = MODULOS.filter((m) => pode(m.acao)).map(
    ({ acao: _acao, ...rest }) => rest
  );

  return (
    <DashboardShowcase
      modulos={disponiveis}
      papel={session.papel}
      clinicaId={session.clinica_id}
    />
  );
}
