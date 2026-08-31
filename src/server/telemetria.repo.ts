import "server-only";
import type { Tx } from "@/lib/db";

/**
 * DAL — Telemetria (Camada A, §9). Só leitura: as views fazem a agregação no
 * banco e são `security_invoker`, então a RLS de tenant continua valendo aqui.
 *
 * A leitura que importa é `intencaoPorTemplate`: cruzar a intenção recebida com
 * o template que a antecedeu é o que transforma "muita gente pergunta preço" em
 * "o lembrete_d1 v3 precisa citar faixa de preço".
 */

export interface LinhaIntencao {
  chave: string;
  versao: number;
  intencao: string;
  respostas: number;
}

export interface LinhaFunil {
  origem: string | null;
  leads: number;
  convertidos: number;
  agendados: number;
  confirmados: number;
  compareceram: number;
  faltaram: number;
}

export async function intencaoPorTemplate(tx: Tx, limite = 50): Promise<LinhaIntencao[]> {
  const { rows } = await tx.query<LinhaIntencao>(
    `SELECT chave, versao, intencao::text AS intencao, respostas::int AS respostas
       FROM v_intencao_por_template
      ORDER BY respostas DESC
      LIMIT $1`,
    [limite]
  );
  return rows;
}

export async function funil(tx: Tx): Promise<LinhaFunil[]> {
  const { rows } = await tx.query<LinhaFunil>(
    `SELECT origem,
            leads::int, convertidos::int, agendados::int,
            confirmados::int, compareceram::int, faltaram::int
       FROM v_funil
      ORDER BY leads DESC`
  );
  return rows;
}

export interface LinhaBarrado {
  motivo: string;
  quantidade: number;
}

/** §9 "registros barrados na validação" — lista de trabalho da recepção. */
export async function barradosPorMotivo(tx: Tx): Promise<LinhaBarrado[]> {
  const { rows } = await tx.query<LinhaBarrado>(
    `SELECT motivo, count(*)::int AS quantidade
       FROM v_barrados_validacao
      GROUP BY motivo
      ORDER BY quantidade DESC`
  );
  return rows;
}
