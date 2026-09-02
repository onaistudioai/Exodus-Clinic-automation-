import { pool, type Tx } from "@/lib/db";
import { getSession } from "@/lib/dal";

export type Canal = "painel" | "whatsapp";

/**
 * B2 — withTenant() (DRAFT-fase0.md §0.2)
 *
 * Helper ÚNICO por onde TODA query do painel passa. Abre uma transação e seta os
 * GUCs `app.clinica_id`, `app.canal` e — quando há sessão de painel —
 * `app.usuario_id`/`app.papel`, todos com escopo LOCAL (vale só nesta tx, não
 * vaza no pool). As policies RLS leem esses GUCs: sem eles -> NULLIF(...,'')::int
 * -> NULL -> 0 linhas (fail-closed). Ver DRAFT-prontuario-modelo.sql, correção #7,
 * e .planning/sofia-acesso/PLANO_EXECUTIVO.md Parte B.
 *
 * REGRA INQUEBRÁVEL: `clinicaId`, `usuario_id` e `papel` vêm SEMPRE da sessão
 * autenticada (JWT, §0.3) — nunca de parâmetro de chamador, body, query string
 * ou header do cliente. Por isso `getSession()` é lido AQUI DENTRO, não recebido
 * como argumento: não existe caminho para um chamador passar um papel diferente
 * do da própria sessão. As rotas /api/sofia/* (canal whatsapp) não têm cookie de
 * sessão — `getSession()` devolve `null` e usuario_id/papel ficam de fora dos
 * GUCs (NULL -> nega por policy de papel, que é o correto: paciente não tem papel
 * de equipe). `paciente_id` para essas rotas entra por `setPacienteId()`, depois
 * que a identidade é confirmada — nunca aqui, porque neste ponto o corpo da
 * requisição ainda não foi verificado.
 *
 * `opts.canal` é só para o caso em que a rota SABE o canal antes de qualquer
 * sessão existir (whatsapp); painel deriva do cookie sozinho.
 */
export async function withTenant<T>(
  clinicaId: number,
  fn: (tx: Tx) => Promise<T>,
  opts?: { canal?: Canal }
): Promise<T> {
  if (!Number.isInteger(clinicaId) || clinicaId <= 0) {
    throw new Error(`withTenant: clinicaId inválido (${clinicaId}).`);
  }
  const session = await getSession();
  const canal: Canal = opts?.canal ?? (session ? "painel" : "whatsapp");

  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    // set_config(name, value, is_local=true) — parametrizável (SET LOCAL não aceita $1).
    await tx.query("SELECT set_config('app.clinica_id', $1, true)", [String(clinicaId)]);
    await tx.query("SELECT set_config('app.canal', $1, true)", [canal]);
    if (session) {
      await tx.query("SELECT set_config('app.usuario_id', $1, true)", [
        String(session.usuario_id),
      ]);
      await tx.query("SELECT set_config('app.papel', $1, true)", [session.papel]);
    }
    const result = await fn(tx);
    await tx.query("COMMIT");
    return result;
  } catch (err) {
    await tx.query("ROLLBACK");
    throw err;
  } finally {
    tx.release();
  }
}

/**
 * Amarra a transação já aberta ao paciente identificado — canal whatsapp,
 * chamada DEPOIS que `identificarPaciente()` confirma quem é (telefone +
 * data de nascimento). `pacienteId` entra aqui sempre como resultado
 * verificado de uma consulta ao banco, nunca como texto de usuário: é essa
 * garantia que torna o `set_config` seguro. Escopo LOCAL, como os demais GUCs.
 */
export async function setPacienteId(tx: Tx, pacienteId: number): Promise<void> {
  if (!Number.isInteger(pacienteId) || pacienteId <= 0) {
    throw new Error(`setPacienteId: pacienteId inválido (${pacienteId}).`);
  }
  await tx.query("SELECT set_config('app.paciente_id', $1, true)", [String(pacienteId)]);
}

/**
 * Variante read-only: mesma garantia de tenant, mas marca a tx como READ ONLY.
 * Use em todas as leituras (check-in busca, prontuário) — defesa em profundidade.
 */
export async function withTenantReadOnly<T>(
  clinicaId: number,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  return withTenant(clinicaId, async (tx) => {
    await tx.query("SET TRANSACTION READ ONLY");
    return fn(tx);
  });
}
