import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as usuarios from "@/server/usuarios.repo";
import SenhaClient from "./SenhaClient";

/**
 * Sem `requireAcao`: qualquer pessoa com login troca a própria senha, inclusive
 * quem não tem permissão para mais nada no painel. `verifySession()` já
 * redireciona para /login quem não estiver autenticado — é a única trava que
 * esta tela precisa ter.
 */
export default async function SenhaPage() {
  const session = await verifySession();

  // Só para o campo oculto de identificação do formulário (ver SenhaClient).
  // Se falhar, a tela continua funcionando: o campo some e o gerenciador de
  // senha volta a não saber a conta — degradação, não erro.
  let email: string | null = null;
  try {
    email = await withTenantReadOnly(session.clinica_id, (tx) =>
      usuarios.emailDe(tx, session.usuario_id)
    );
  } catch {
    /* segue sem o campo */
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">Minha conta</h1>
        <p className="text-sm text-neutral-400">
          Troque a senha que você recebeu. Enquanto não trocar, quem criou o seu acesso
          continua conhecendo ela.
        </p>
      </div>
      <SenhaClient email={email} />
    </div>
  );
}
