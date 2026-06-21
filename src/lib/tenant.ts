import { pool, type Tx } from "@/lib/db";

/**
 * B2 — withTenant() (DRAFT-fase0.md §0.2)
 *
 * Helper ÚNICO por onde TODA query do painel passa. Abre uma transação e seta o
 * GUC `app.clinica_id` com escopo LOCAL (vale só nesta tx, não vaza no pool).
 * A policy RLS lê esse GUC: sem ele -> NULLIF(...,'')::int -> NULL -> 0 linhas
 * (fail-closed). Ver DRAFT-prontuario-modelo.sql, correção #7.
 *
 * REGRA INQUEBRÁVEL: `clinicaId` vem SEMPRE da sessão autenticada (JWT, §0.3),
 * NUNCA de body/query string/header do cliente. Quem chama isto já resolveu a
 * sessão; este helper não aceita tenant "de fora".
 */
export async function withTenant<T>(
  clinicaId: number,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  if (!Number.isInteger(clinicaId) || clinicaId <= 0) {
    throw new Error(`withTenant: clinicaId inválido (${clinicaId}).`);
  }
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    // set_config(name, value, is_local=true) — parametrizável (SET LOCAL não aceita $1).
    await tx.query("SELECT set_config('app.clinica_id', $1, true)", [String(clinicaId)]);
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
