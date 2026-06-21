import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { podeFazer } from "@/lib/rbac";

export default async function HomePage() {
  const session = await verifySession();

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Início</h1>
      <p className="mb-8 text-sm text-neutral-500">
        O que você pode fazer como <b>{session.papel}</b>:
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {podeFazer(session.papel, "checkin") && (
          <Link
            href="/checkin"
            className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5 hover:ring-neutral-900"
          >
            <h2 className="font-medium">Check-in</h2>
            <p className="text-sm text-neutral-500">
              Buscar paciente, criar ficha e confirmar identidade.
            </p>
          </Link>
        )}
        {podeFazer(session.papel, "ler_texto_clinico") && (
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5 opacity-60">
            <h2 className="font-medium">Prontuário</h2>
            <p className="text-sm text-neutral-500">Ler e registrar atendimentos (em construção).</p>
          </div>
        )}
        {podeFazer(session.papel, "ver_auditoria") && (
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5 opacity-60">
            <h2 className="font-medium">Auditoria</h2>
            <p className="text-sm text-neutral-500">Quem acessou o quê (em construção).</p>
          </div>
        )}
      </div>
    </div>
  );
}
