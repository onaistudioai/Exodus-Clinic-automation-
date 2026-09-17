import Link from "next/link";

/**
 * Renderizada quando `forbidden()` é chamado — hoje só por `requireAcao()`
 * (src/lib/rbac.ts). O Next responde HTTP 403.
 *
 * NÃO diz qual ação faltou nem qual papel a pessoa tem. Quem chegou aqui
 * digitando a URL não precisa de um mapa do que existe do outro lado; e o
 * detalhe já está no log do servidor, que é onde ele serve para alguma coisa.
 */
export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Sem permissão</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Seu papel nesta clínica não dá acesso a esta página. Se você precisa dela, peça a
        quem administra a equipe.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex w-fit rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
      >
        Voltar ao início
      </Link>
    </main>
  );
}
