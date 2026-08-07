import { verifySession } from "@/lib/dal";
import { podeFazer } from "@/lib/rbac";
import { MODULOS } from "./modulos";
import DashboardShowcase from "./DashboardShowcase";

export default async function HomePage() {
  const session = await verifySession();
  const disponiveis = MODULOS.filter((m) => podeFazer(session.papel, m.acao)).map(
    ({ acao: _acao, ...rest }) => rest // eslint-disable-line @typescript-eslint/no-unused-vars
  );

  return (
    <DashboardShowcase
      modulos={disponiveis}
      papel={session.papel}
      clinicaId={session.clinica_id}
    />
  );
}
