import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as usuarios from "@/server/usuarios.repo";
import UsuariosClient from "./UsuariosClient";

export default async function UsuariosPage() {
  // Só quem tem `gerir_usuarios` (hoje: admin). A policy RESTRICTIVE de
  // acesso-016 nega de novo no banco — esta camada é a mensagem de erro boa,
  // não a trava.
  await requireAcao("gerir_usuarios");
  const session = await verifySession();

  const { equipe, papeis } = await withTenantReadOnly(session.clinica_id, async (tx) => ({
    equipe: await usuarios.listar(tx),
    // Papéis vêm da TABELA, não de literal no TypeScript: `usuarios.papel` é FK
    // para `papel.chave` desde a acesso-016.
    papeis: await usuarios.papeisDisponiveis(tx),
  }));

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">Equipe</h1>
        <p className="text-sm text-neutral-500">
          Quem tem acesso ao painel desta clínica. O papel define o que a pessoa consegue
          fazer — escolha com cuidado, é a permissão inteira.
        </p>
      </div>

      <UsuariosClient equipe={equipe} papeis={papeis} eu={session.usuario_id} />
    </div>
  );
}
