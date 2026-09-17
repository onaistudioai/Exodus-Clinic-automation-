import { verifySession } from "@/lib/dal";
import { permissoes } from "@/lib/rbac";
import { withTenantReadOnly } from "@/lib/tenant";
import * as crm from "@/server/crm.repo";
import type { ContagemEstagio, LinhaPipeline } from "@/types/domain";
import PipelinePacientes from "./crm/PipelinePacientes";

/**
 * A home É o CRM. A vitrine circular que existia aqui repetia, com mais
 * animação, exatamente os links que já estão na navegação do topo — a tela de
 * entrada gastava uma tela inteira sem dizer nada que o menu já não dissesse.
 *
 * `pode()` em vez de `requireAcao()`: esta é a rota raiz do painel e ela não
 * pode devolver 403. `ver_crm` hoje é concedida aos três papéis, mas isso é
 * DADO em `papel_acao` — se alguém a remover de um papel amanhã, a pessoa perde
 * o CRM, não a porta de entrada do sistema.
 */
export default async function HomePage() {
  const session = await verifySession();
  const { pode } = await permissoes();

  if (!pode("ver_crm")) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold">Painel</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Escolha um módulo no menu acima.
        </p>
      </div>
    );
  }

  let contagem: ContagemEstagio[] = [];
  let linhas: LinhaPipeline[] = [];
  let saudacao = "Olá";
  try {
    [contagem, linhas, saudacao] = await withTenantReadOnly(session.clinica_id, async (tx) => {
      // A hora sai do fuso da CLÍNICA, não do servidor. Calcular no servidor
      // daria UTC e a tela diria "Bom dia" às nove da noite em São Paulo.
      const { rows } = await tx.query<{ hora: string }>(
        `SELECT to_char(now() AT TIME ZONE
                  (SELECT timezone FROM clinicas WHERE id = current_setting('app.clinica_id')::int),
                'HH24') AS hora`
      );
      const h = Number(rows[0]?.hora ?? 12);
      return [
        await crm.contarPorEstagio(tx),
        await crm.listarPipeline(tx, { limite: 300 }),
        h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite",
      ] as const;
    });
  } catch {
    // Sem dado ainda ou tabela não migrada: estado vazio em vez de quebrar a
    // porta de entrada. Mesma postura de crm/page.tsx.
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">
          {saudacao}, {session.papel}.
        </h1>
        <p className="text-sm text-neutral-500">
          Seus pacientes por estágio de relacionamento. Clique para abrir a ficha 360.
        </p>
      </div>
      <PipelinePacientes contagem={contagem} linhas={linhas} />
    </div>
  );
}
