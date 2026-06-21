import { Pool, type PoolClient } from "pg";

/**
 * Pool único do painel. Conecta como role `app_painel` (NÃO-dono, NOBYPASSRLS):
 * a RLS FORCE das tabelas só constrange de verdade porque este role não é dono.
 * Ver DRAFT-fase0.md §0.1.
 *
 * A connection string aponta pro Railway Postgres via proxy público durante o dev
 * (TCP proxy), e via `postgres.railway.internal` quando o painel rodar dentro da
 * mesma rede Railway. Trocar a senha placeholder quando o Processo A entregar
 * `app_painel` (sync point A1).
 */
declare global {
  // eslint-disable-next-line no-var
  var _aiosPainelPool: Pool | undefined;
}

function makePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL ausente. Configure a variável apontando para app_painel@Railway PG."
    );
  }
  return new Pool({
    connectionString,
    // Railway PG público exige TLS; `no-verify` só enquanto dev (proxy self-signed).
    ssl: process.env.PGSSL_DISABLE === "1" ? undefined : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

/**
 * Pool LAZY: só instancia (e valida DATABASE_URL) na 1ª query, não no import.
 * Assim um env ausente não derruba rotas que nem tocam o banco (ex.: /login render),
 * e o erro fica restrito a quem de fato consulta. Reusa entre hot-reloads do dev.
 */
export function getPool(): Pool {
  if (!global._aiosPainelPool) global._aiosPainelPool = makePool();
  return global._aiosPainelPool;
}

/** Proxy fino: `pool.query(...)` continua funcionando, mas conecta sob demanda. */
export const pool = new Proxy({} as Pool, {
  get(_t, prop) {
    const p = getPool();
    const v = (p as unknown as Record<string | symbol, unknown>)[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(p) : v;
  },
}) as Pool;

export type Tx = PoolClient;
