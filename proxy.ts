import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

/**
 * Next 16: middleware foi renomeado para Proxy (proxy.ts na raiz). Aqui fazemos
 * APENAS o check OTIMISTA recomendado pelos docs (presença do cookie de sessão) —
 * a verificação real (assinatura/expiração + RBAC) acontece no DAL, perto dos dados.
 * NÃO usar proxy como única linha de defesa (docs: authentication#optimistic-checks).
 */
const ROTAS_PUBLICAS = ["/login", "/preview"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const ehPublica =
    ROTAS_PUBLICAS.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    pathname.startsWith("/api/auth");

  const temCookie = req.cookies.has(SESSION_COOKIE);

  if (!ehPublica && !temCookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (ehPublica && temCookie && pathname === "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // tudo menos assets estáticos e otimização de imagem
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
