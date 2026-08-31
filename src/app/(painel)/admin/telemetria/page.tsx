import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import * as telemetria from "@/server/telemetria.repo";

/**
 * Telemetria (Camada A, ex-etapa 1). Aba de admin, não módulo próprio: é leitura
 * de gestão, e o catálogo de módulos já tem 10 entradas.
 */
export default async function TelemetriaPage() {
  await requireAcao("ver_auditoria");
  const session = await verifySession();

  const [intencoes, funil, barrados] = await withTenantReadOnly(session.clinica_id, async (tx) => [
    await telemetria.intencaoPorTemplate(tx),
    await telemetria.funil(tx),
    await telemetria.barradosPorMotivo(tx),
  ]);

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">Telemetria</h1>
        <p className="text-sm text-neutral-500">
          Se todo mundo pergunta onde fica o banheiro, o problema é a placa. Aqui cada
          dúvida recebida aparece junto do template que a antecedeu.
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-neutral-700">
          Intenção recebida × template que a antecedeu
        </h2>
        {intencoes.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Sem dados ainda — nenhuma mensagem de saída foi enviada com template versionado.
          </p>
        ) : (
          <table className="w-full overflow-hidden rounded-2xl bg-white text-sm ring-1 ring-black/5">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
              <tr>
                <th className="p-2 font-medium">Template</th>
                <th className="p-2 font-medium">Versão</th>
                <th className="p-2 font-medium">Intenção</th>
                <th className="p-2 text-right font-medium">Respostas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {intencoes.map((i) => (
                <tr key={`${i.chave}-${i.versao}-${i.intencao}`}>
                  <td className="p-2">{i.chave}</td>
                  <td className="p-2 text-neutral-500">v{i.versao}</td>
                  <td className="p-2">{i.intencao}</td>
                  <td className="p-2 text-right tabular-nums">{i.respostas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-neutral-700">Funil por origem</h2>
        {funil.length === 0 ? (
          <p className="text-sm text-neutral-500">Sem leads registrados.</p>
        ) : (
          <table className="w-full overflow-hidden rounded-2xl bg-white text-sm ring-1 ring-black/5">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
              <tr>
                <th className="p-2 font-medium">Origem</th>
                <th className="p-2 text-right font-medium">Leads</th>
                <th className="p-2 text-right font-medium">Agendados</th>
                <th className="p-2 text-right font-medium">Confirmados</th>
                <th className="p-2 text-right font-medium">Compareceram</th>
                <th className="p-2 text-right font-medium">Faltaram</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {funil.map((f) => (
                <tr key={f.origem ?? "sem_origem"}>
                  <td className="p-2">{f.origem ?? "—"}</td>
                  <td className="p-2 text-right tabular-nums">{f.leads}</td>
                  <td className="p-2 text-right tabular-nums">{f.agendados}</td>
                  <td className="p-2 text-right tabular-nums">{f.confirmados}</td>
                  <td className="p-2 text-right tabular-nums">{f.compareceram}</td>
                  <td className="p-2 text-right tabular-nums">{f.faltaram}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-neutral-700">
          Barrados na catraca (não entram na fila de disparo)
        </h2>
        {barrados.length === 0 ? (
          <p className="text-sm text-neutral-500">Nenhum registro barrado — a fila está limpa.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-white ring-1 ring-black/5">
            {barrados.map((b) => (
              <li key={b.motivo} className="flex justify-between p-2 text-sm">
                <span>{b.motivo}</span>
                <span className="tabular-nums text-neutral-500">{b.quantidade}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
