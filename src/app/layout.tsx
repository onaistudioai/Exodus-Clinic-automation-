import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIOS Painel",
  description: "Painel clínico AIOS.clinic — check-in e prontuário",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
