import type { NextConfig } from "next";

/**
 * S7 — Headers de segurança.
 *
 * CSP: o painel tem <script> inline (tema, evita flash) e o Prism usa WebGL, então
 * 'unsafe-inline'/'unsafe-eval' em script-src ainda são necessários — o que
 * enfraquece a CSP como defesa contra XSS. A defesa primária continua sendo o
 * React escapando por padrão (não há innerHTML com input de usuário no projeto).
 * ponytail: trocar por nonce quando o script de tema virar componente com nonce.
 *
 * frame-ancestors 'none': prontuário nunca deve ser embutido em iframe de
 * terceiro (clickjacking sobre dado de saúde).
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    /**
     * Libera `forbidden()` de next/navigation + a convenção `app/forbidden.tsx`,
     * usados por `requireAcao()` (src/lib/rbac.ts).
     *
     * Por que a flag experimental foi aceita: antes disso, `requireAcao` lançava
     * um Error comum e o Next respondia HTTP 500 com a página genérica "This
     * page couldn't load" — negação correta (nada vazava), apresentação de
     * crash. Achado na verificação pós-deploy de 2026-09-05, acessando
     * /admin/usuarios como recepção.
     *
     * Por que não um `error.tsx` casando a mensagem: em produção o Next APAGA a
     * mensagem antes de entregá-la ao boundary — sobra só o `digest`. Distinguir
     * "sem permissão" de "quebrou" por texto funciona em dev e falha em prod,
     * que é a pior combinação possível.
     *
     * Risco contido: se a flag sumir num upgrade, `forbidden()` volta a ser um
     * throw não tratado e o comportamento degrada para o 500 de hoje — nunca
     * para acesso concedido.
     */
    authInterrupts: true,
  },
  // Não vazar framework/versão para quem faz fingerprint.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          // 2 anos (exigido para preload). Só tem efeito sobre HTTPS.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
      {
        // Dado de paciente nunca em cache de proxy/CDN.
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
