import { Pool, type PoolClient } from "pg";

/**
 * Pool único do painel. Conecta como role `app_painel` (NÃO-dono, NOBYPASSRLS):
 * a RLS FORCE das tabelas só constrange de verdade porque este role não é dono.
 * Ver DRAFT-fase0.md §0.1.
 *
 * `DATABASE_URL` aponta para o Postgres gerenciado (Neon) com `sslmode=verify-full`.
 * A senha DEVE ser a rotacionada pós-vazamento de 2026-06-23 — a antiga é pública.
 */
declare global {
  var _aiosPainelPool: Pool | undefined;
}

/**
 * S3 — TLS verificado por padrão.
 *
 * Antes: `rejectUnauthorized: false` aceitava QUALQUER certificado, inclusive o de
 * um MITM entre o app e o banco. Como o tráfego carrega dado de saúde, isso é
 * inaceitável em produção.
 *
 * Neon/Hetzner usam CA pública → a store de CAs do sistema já valida. `PGSSL_CA_CERT`
 * (PEM) cobre o caso de CA própria. `PGSSL_DISABLE=1` só existe para Postgres local
 * sem TLS e é IGNORADO em produção — fail-closed é o comportamento certo aqui.
 */
function sslConfig() {
  const emProducao = process.env.NODE_ENV === "production";

  if (process.env.PGSSL_DISABLE === "1") {
    if (emProducao) {
      throw new Error(
        "PGSSL_DISABLE=1 não é permitido em produção: a conexão com o banco carrega dado de saúde e precisa de TLS verificado."
      );
    }
    return undefined;
  }

  const ca = process.env.PGSSL_CA_CERT;
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
}

function makePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL ausente. Configure a variável apontando para app_painel no Postgres (Neon)."
    );
  }
  return new Pool({
    connectionString,
    ssl: sslConfig(),
    // L1: dimensionável por env (default 10). Subir junto da cota de conexões do PG
    // se o tráfego crescer; com os timeouts do M4, um slot não fica preso à toa.
    max: Number(process.env.DB_POOL_MAX) || 10,
    idleTimeoutMillis: 30_000,
    // M4: timeouts explícitos para nenhuma request pendurar um slot do pool
    // indefinidamente (contenção de FOR UPDATE / lock). `statement_timeout`
    // (server) cancela a query; `query_timeout` (client) é a salvaguarda; e
    // `lock_timeout` faz a baixa desistir rápido em vez de fila no FOR UPDATE.
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    query_timeout: 15_000,
    idle_in_transaction_session_timeout: 20_000,
    // INCOMPATÍVEL COM A CONNECTION STRING POOLED DO NEON. O pooler recusa
    // parâmetros de startup que não conhece e devolve "unsupported startup
    // parameter", derrubando TODA query — não só as que dependem do timeout.
    // DATABASE_URL tem de apontar para o host direto (o mesmo endereço sem
    // `-pooler`), que é justamente o que o console do Neon NÃO destaca para
    // copiar. Ver a nota em .env.local.example. Custou um deploy para descobrir.
    options: "-c lock_timeout=5000",
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
