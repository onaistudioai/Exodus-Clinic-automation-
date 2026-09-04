import { verifySession } from "@/lib/dal";
import SenhaClient from "./SenhaClient";

/**
 * Sem `requireAcao`: qualquer pessoa com login troca a própria senha, inclusive
 * quem não tem permissão para mais nada no painel. `verifySession()` já
 * redireciona para /login quem não estiver autenticado — é a única trava que
 * esta tela precisa ter.
 */
export default async function SenhaPage() {
  await verifySession();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">Minha conta</h1>
        <p className="text-sm text-neutral-500">
          Troque a senha que você recebeu. Enquanto não trocar, quem criou o seu acesso
          continua conhecendo ela.
        </p>
      </div>
      <SenhaClient />
    </div>
  );
}
