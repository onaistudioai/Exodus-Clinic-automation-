import type { Metadata } from "next";
import { Elms_Sans } from "next/font/google";
import "./globals.css";

/**
 * Fonte por `next/font/google`, não por `<link>` para fonts.googleapis.com.
 *
 * O `<link>` anterior era bloqueado pela CSP em produção (`style-src 'self'
 * 'unsafe-inline'` não libera fonts.googleapis.com, e `font-src 'self' data:`
 * não libera fonts.gstatic.com) — o painel caía na fonte de sistema sem que
 * nada acusasse além de um aviso no console. Achado na verificação pós-deploy
 * de 2026-09-05.
 *
 * Afrouxar a CSP resolveria e seria pior: `next/font` baixa a fonte no BUILD e
 * a serve do próprio domínio, então não existe requisição externa nenhuma para
 * liberar. A CSP continua apertada, some o preconnect, some o stylesheet que
 * bloqueia render, e o dado de navegação do usuário deixa de ir para o Google.
 */
const elms = Elms_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-elms",
});

export const metadata: Metadata = {
  title: "EXODUS · Painel clínico",
  description: "Painel clínico AIOS.clinic — check-in, prontuário, agenda e financeiro",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={elms.variable}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
