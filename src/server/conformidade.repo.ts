import "server-only";
import type { Tx } from "@/lib/db";

/**
 * DAL — Relatório de Conformidade (LGPD / auditoria).
 *
 * Não cria dado novo: agrega os livros-razão que já existem
 * (consentimento_eventos, movimentacoes_estoque, reativacao_envios,
 * prontuario_acessos). É o que a clínica leva para uma fiscalização e o que o
 * DPA (Anexo III, cláusula 10) promete como auditável.
 *
 * Toda consulta filtra por clinica_id do GUC — as tabelas já têm RLS FORCE, o
 * filtro explícito é redundante e proposital (padrão da casa).
 *
 * Cada seção falha de forma independente: módulo não migrado devolve `null`, e a
 * página declara "sem dado" em vez de mostrar zero — zero e ausência não são a
 * mesma coisa num relatório de conformidade.
 */

export interface ConsentimentoPorOrigem {
  origem: string;
  optin: number;
  optout: number;
  primeiro: string;
  ultimo: string;
}

export interface ResumoLivro {
  registros: number;
  desde: string | null;
  ate: string | null;
}

export interface AcessoPorUsuario {
  usuario_nome: string | null;
  usuario_papel: string | null;
  acessos: number;
  ultimo: string;
}

export interface RelatorioConformidade {
  gerado_em: string;
  consentimentos: ConsentimentoPorOrigem[] | null;
  contatos: { total: number; com_optin: number; com_optout: number; sem_registro: number } | null;
  estoque: ResumoLivro | null;
  envios: ResumoLivro | null;
  acessos: { por_usuario: AcessoPorUsuario[]; total: number } | null;
  escalonamentos: { abertos: number; resolvidos: number; total: number } | null;
}

/** Executa a seção e devolve null se a tabela não existir (módulo não migrado). */
async function secao<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export async function gerarRelatorio(tx: Tx, dias = 365): Promise<RelatorioConformidade> {
  const TENANT = `current_setting('app.clinica_id')::int`;

  const consentimentos = await secao(async () => {
    const { rows } = await tx.query<ConsentimentoPorOrigem>(
      `SELECT origem,
              count(*) FILTER (WHERE tipo = 'optin')::int  AS optin,
              count(*) FILTER (WHERE tipo = 'optout')::int AS optout,
              to_char(min(registrado_em),'YYYY-MM-DD') AS primeiro,
              to_char(max(registrado_em),'YYYY-MM-DD') AS ultimo
         FROM consentimento_eventos
        WHERE clinica_id = ${TENANT}
        GROUP BY origem
        ORDER BY count(*) DESC`
    );
    return rows;
  });

  const contatos = await secao(async () => {
    const { rows } = await tx.query<{
      total: number; com_optin: number; com_optout: number; sem_registro: number;
    }>(
      `SELECT count(*)::int                                          AS total,
              count(*) FILTER (WHERE marketing_optin IS TRUE)::int   AS com_optin,
              count(*) FILTER (WHERE marketing_optin IS FALSE)::int  AS com_optout,
              count(*) FILTER (WHERE marketing_optin IS NULL)::int   AS sem_registro
         FROM contatos_whatsapp
        WHERE clinica_id = ${TENANT}`
    );
    return rows[0];
  });

  const livro = (tabela: string, coluna: string) =>
    secao(async () => {
      const { rows } = await tx.query<ResumoLivro>(
        `SELECT count(*)::int AS registros,
                to_char(min(${coluna}),'YYYY-MM-DD') AS desde,
                to_char(max(${coluna}),'YYYY-MM-DD') AS ate
           FROM ${tabela}
          WHERE clinica_id = ${TENANT}
            AND ${coluna} >= NOW() - ($1 || ' days')::interval`,
        [dias]
      );
      return rows[0];
    });

  // nomes de tabela/coluna são literais do código, nunca entrada de usuário.
  const estoque = await livro("movimentacoes_estoque", "criado_em");
  const envios = await livro("reativacao_envios", "enviado_em");

  const acessos = await secao(async () => {
    const { rows } = await tx.query<AcessoPorUsuario>(
      `SELECT u.nome AS usuario_nome, u.papel AS usuario_papel,
              count(*)::int AS acessos,
              to_char(max(a.criado_em),'YYYY-MM-DD"T"HH24:MI:SS') AS ultimo
         FROM prontuario_acessos a
         LEFT JOIN usuarios u ON u.id = a.usuario_id
        WHERE a.clinica_id = ${TENANT}
          AND a.criado_em >= NOW() - ($1 || ' days')::interval
        GROUP BY u.nome, u.papel
        ORDER BY count(*) DESC`,
      [dias]
    );
    return { por_usuario: rows, total: rows.reduce((s, r) => s + r.acessos, 0) };
  });

  const escalonamentos = await secao(async () => {
    const { rows } = await tx.query<{ abertos: number; resolvidos: number; total: number }>(
      `SELECT count(*) FILTER (WHERE status <> 'resolvido')::int AS abertos,
              count(*) FILTER (WHERE status = 'resolvido')::int  AS resolvidos,
              count(*)::int                                      AS total
         FROM escalonamentos
        WHERE clinica_id = ${TENANT}`
    );
    return rows[0];
  });

  return {
    gerado_em: new Date().toISOString(),
    consentimentos,
    contatos,
    estoque,
    envios,
    acessos,
    escalonamentos,
  };
}
