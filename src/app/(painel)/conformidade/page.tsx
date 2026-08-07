import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import { gerarRelatorio } from "@/server/conformidade.repo";
import type { RelatorioConformidade } from "@/server/conformidade.repo";

/**
 * Relatório de Conformidade — admin. Reusa a ação existente `ver_auditoria`
 * (já admin-only no rbac.ts); nenhuma ação nova foi criada.
 *
 * Agrega livros-razão que já existem. Seção sem dado é declarada como ausente,
 * nunca renderizada como zero — num relatório de conformidade, "não medido" e
 * "medido e deu zero" são afirmações diferentes.
 */
export default async function ConformidadePage() {
  await requireAcao("ver_auditoria");
  const session = await verifySession();

  let r: RelatorioConformidade | null = null;
  try {
    r = await withTenantReadOnly(session.clinica_id, (tx) => gerarRelatorio(tx));
  } catch {
    // banco indisponível: estado vazio em vez de quebrar a página.
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">Conformidade</h1>
        <p className="text-sm text-neutral-500">
          Registros imutáveis mantidos pelo sistema. Base para auditoria interna, para
          resposta a titular de dados e para fiscalização.
        </p>
        {r && (
          <p className="mt-2 text-xs text-neutral-400">
            Gerado em {new Date(r.gerado_em).toLocaleString("pt-BR")} · últimos 365 dias
          </p>
        )}
      </div>

      {!r ? (
        <Ausente titulo="Relatório indisponível" motivo="Não foi possível consultar o banco." />
      ) : (
        <>
          <Secao titulo="Consentimento de marketing (LGPD art. 8º §2º)">
            {!r.contatos ? (
              <Ausente titulo="Consentimento" motivo="Migração 004 ainda não aplicada." />
            ) : (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Card label="Contatos" valor={r.contatos.total} />
                  <Card label="Com opt-in" valor={r.contatos.com_optin} cls="text-emerald-700" />
                  <Card label="Opt-out" valor={r.contatos.com_optout} cls="text-amber-700" />
                  <Card
                    label="Sem registro"
                    valor={r.contatos.sem_registro}
                    cls="text-neutral-400"
                  />
                </div>
                <p className="mb-3 text-xs text-neutral-500">
                  Contatos sem registro não recebem campanha — o sistema é fail-closed.
                </p>
                {r.consentimentos && r.consentimentos.length > 0 ? (
                  <Tabela
                    cols={["Origem", "Opt-in", "Opt-out", "Primeiro", "Último"]}
                    linhas={r.consentimentos.map((c) => [
                      c.origem,
                      c.optin,
                      c.optout,
                      c.primeiro,
                      c.ultimo,
                    ])}
                  />
                ) : (
                  <p className="text-sm text-neutral-400">Nenhum evento registrado.</p>
                )}
              </>
            )}
          </Secao>

          <Secao titulo="Acesso a prontuário">
            {!r.acessos ? (
              <Ausente titulo="Trilha de acesso" motivo="Tabela não disponível." />
            ) : r.acessos.por_usuario.length === 0 ? (
              <p className="text-sm text-neutral-400">Nenhum acesso no período.</p>
            ) : (
              <>
                <p className="mb-3 text-xs text-neutral-500">
                  {r.acessos.total} acessos registrados. Toda leitura e escrita clínica é
                  gravada com autor, paciente e horário.
                </p>
                <Tabela
                  cols={["Usuário", "Papel", "Acessos", "Último"]}
                  linhas={r.acessos.por_usuario.map((a) => [
                    a.usuario_nome ?? "(removido)",
                    a.usuario_papel ?? "—",
                    a.acessos,
                    new Date(a.ultimo).toLocaleString("pt-BR"),
                  ])}
                />
              </>
            )}
          </Secao>

          <Secao titulo="Livros-razão imutáveis">
            <p className="mb-3 text-xs text-neutral-500">
              Registros que o próprio banco impede de alterar ou apagar.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Livro titulo="Movimentação de estoque" dado={r.estoque} />
              <Livro titulo="Envios de campanha" dado={r.envios} />
            </div>
          </Secao>

          <Secao titulo="Encaminhamentos a humano (Anexo I §5)">
            {!r.escalonamentos ? (
              <Ausente titulo="Fila de encaminhamento" motivo="Migração 007 ainda não aplicada." />
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <Card label="Abertos" valor={r.escalonamentos.abertos} cls="text-amber-700" />
                <Card label="Resolvidos" valor={r.escalonamentos.resolvidos} />
                <Card label="Total" valor={r.escalonamentos.total} />
              </div>
            )}
          </Secao>
        </>
      )}
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-neutral-700">{titulo}</h2>
      {children}
    </section>
  );
}

function Card({ label, valor, cls }: { label: string; valor: number; cls?: string }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-black/5">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${cls ?? ""}`}>{valor}</div>
    </div>
  );
}

function Livro({
  titulo,
  dado,
}: {
  titulo: string;
  dado: { registros: number; desde: string | null; ate: string | null } | null;
}) {
  if (!dado) return <Ausente titulo={titulo} motivo="Módulo não disponível." />;
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-black/5">
      <div className="text-xs text-neutral-500">{titulo}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{dado.registros}</div>
      <div className="mt-1 text-xs text-neutral-400">
        {dado.desde ? `${dado.desde} → ${dado.ate}` : "sem registros no período"}
      </div>
    </div>
  );
}

/** Ausência declarada — nunca renderizar zero no lugar de "não medido". */
function Ausente({ titulo, motivo }: { titulo: string; motivo: string }) {
  return (
    <div className="rounded-xl bg-neutral-50 p-4 ring-1 ring-black/5">
      <div className="text-xs font-medium text-neutral-600">{titulo}</div>
      <div className="mt-1 text-sm text-neutral-400">Sem dado disponível — {motivo}</div>
    </div>
  );
}

function Tabela({ cols, linhas }: { cols: string[]; linhas: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
            {cols.map((c) => (
              <th key={c} className="px-4 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} className="border-b border-neutral-50 last:border-0">
              {l.map((v, j) => (
                <td key={j} className="px-4 py-2 tabular-nums">
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
