import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { podeFazer } from "@/lib/rbac";
import { logoutAction } from "./actions";

/**
 * Layout protegido do painel. Roda verifySession() UMA vez para todo o grupo
 * (proxy já fez o check otimista; aqui é a verificação real perto do dado).
 * Desenha a navegação conforme o papel. Cada página ainda aplica seu requireAcao.
 */
export default async function PainelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await verifySession();

  const links: { href: string; label: string }[] = [];
  if (podeFazer(session.papel, "checkin")) links.push({ href: "/checkin", label: "Check-in" });
  if (podeFazer(session.papel, "checkin")) links.push({ href: "/merge", label: "Mesclar" });
  if (podeFazer(session.papel, "ler_texto_clinico"))
    links.push({ href: "/prontuario", label: "Prontuário" });
  if (podeFazer(session.papel, "ver_estoque"))
    links.push({ href: "/estoque", label: "Estoque" });
  if (podeFazer(session.papel, "ver_agenda"))
    links.push({ href: "/agenda", label: "Agenda" });
  if (podeFazer(session.papel, "ver_reativacao"))
    links.push({ href: "/reativacao", label: "Reativação" });
  if (podeFazer(session.papel, "ver_financeiro"))
    links.push({ href: "/financeiro", label: "Financeiro" });
  if (podeFazer(session.papel, "ver_auditoria"))
    links.push({ href: "/admin/auditoria", label: "Auditoria" });

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-semibold">
              AIOS Painel
            </Link>
            <nav className="flex gap-4 text-sm text-neutral-600">
              {links.map((l) => (
                <Link key={l.href} href={l.href} className="hover:text-neutral-900">
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-neutral-500">
            <span>
              clínica #{session.clinica_id} · <b>{session.papel}</b>
            </span>
            <form action={logoutAction}>
              <button className="rounded-lg border border-neutral-300 px-2.5 py-1 hover:border-neutral-900">
                sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
    </div>
  );
}
