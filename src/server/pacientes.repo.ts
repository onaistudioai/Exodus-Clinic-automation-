import "server-only";
import type { Tx } from "@/lib/db";
import type {
  ResultadoBusca,
  NovoPaciente,
  NovoResponsavel,
  ResumoMerge,
} from "@/types/domain";

/**
 * Data Access Layer — Pacientes. Funções recebem `tx` (transação já aberta por
 * withTenant, com o GUC app.clinica_id setado). NÃO abrem transação nem leem sessão.
 * `clinica_id` nos INSERTs vem do GUC (current_setting), nunca de parâmetro do cliente.
 * Contrato: DRAFT-prontuario-modelo.sql.
 */

const SELECT_BUSCA = `
  SELECT p.id,
         p.nome_completo,
         to_char(p.data_nascimento, 'YYYY-MM-DD')      AS data_nascimento,
         date_part('year', age(p.data_nascimento))::int AS idade,
         fn_e_menor(p.data_nascimento)                  AS e_menor,
         p.cpf_last4,
         to_char(ult.ultimo, 'YYYY-MM-DD')              AS ultimo_atendimento
    FROM pacientes p
    LEFT JOIN LATERAL (
      SELECT max(a.data_agendamento) AS ultimo
        FROM agendamentos_sofia_demo a
       WHERE a.paciente_id = p.id AND a.status = 'realizada'
    ) ult ON true
   WHERE p.status = 'ativo'
`;

/** Caminho A: lookup determinístico por hash de CPF. */
export async function buscarPorCpf(tx: Tx, cpfHash: string): Promise<ResultadoBusca[]> {
  const { rows } = await tx.query<ResultadoBusca>(
    `${SELECT_BUSCA} AND p.cpf_hash = $1 LIMIT 5`,
    [cpfHash]
  );
  return rows;
}

/** Caminho B: busca global na clínica por nome (correção #1 do schema). */
export async function buscarPorNome(tx: Tx, termo: string): Promise<ResultadoBusca[]> {
  const { rows } = await tx.query<ResultadoBusca>(
    `${SELECT_BUSCA}
       AND lower(p.nome_completo) LIKE '%' || lower($1) || '%'
     ORDER BY p.nome_completo
     LIMIT 20`,
    [termo]
  );
  return rows;
}

/** Cria paciente. clinica_id vem do GUC. Pode lançar 23505 (CPF duplicado na clínica). */
export async function criar(tx: Tx, p: NovoPaciente): Promise<number> {
  const { rows } = await tx.query<{ id: number }>(
    `INSERT INTO pacientes
       (clinica_id, nome_completo, data_nascimento, cpf_hash, cpf_last4, status, criado_por)
     VALUES (current_setting('app.clinica_id')::int, $1, $2, $3, $4, 'ativo', $5)
     RETURNING id`,
    [p.nome, p.dataNascimento, p.cpfHash, p.cpfLast4, p.criadoPor]
  );
  return rows[0].id;
}

/**
 * Cria o responsável (que é um paciente) e o vínculo paciente_responsavel +
 * consentimento. Usado quando o paciente é menor. Tudo na MESMA tx do paciente.
 */
export async function vincularResponsavel(
  tx: Tx,
  pacienteId: number,
  r: NovoResponsavel
): Promise<number> {
  const ins = await tx.query<{ id: number }>(
    `INSERT INTO pacientes (clinica_id, nome_completo, data_nascimento, status, criado_por)
     VALUES (current_setting('app.clinica_id')::int, $1, $2, 'ativo', $3)
     RETURNING id`,
    [r.nome, r.dataNascimento, r.consentimentoPor]
  );
  const responsavelId = ins.rows[0].id;

  await tx.query(
    `INSERT INTO paciente_responsavel
       (clinica_id, paciente_id, responsavel_id, relacao, recebe_mensagens,
        consentimento_em, consentimento_por, ativo)
     VALUES (current_setting('app.clinica_id')::int, $1, $2, $3, true, NOW(), $4, true)`,
    [pacienteId, responsavelId, r.relacao, r.consentimentoPor]
  );
  return responsavelId;
}

/**
 * Resumo p/ a tela de merge: dados de conferência + contagem do que será movido.
 * RLS cobre `pacientes`/`prontuario_entradas`; `agendamentos_sofia_demo` está fora da
 * RLS → filtro explícito por current_setting('app.clinica_id').
 */
export async function resumoParaMerge(tx: Tx, id: number): Promise<ResumoMerge | null> {
  const { rows } = await tx.query<ResumoMerge>(
    `SELECT p.id,
            p.nome_completo,
            to_char(p.data_nascimento,'YYYY-MM-DD')      AS data_nascimento,
            date_part('year', age(p.data_nascimento))::int AS idade,
            p.cpf_last4,
            p.status,
            (SELECT count(*)::int FROM agendamentos_sofia_demo a
              WHERE a.paciente_id = p.id
                AND a.clinica_id = current_setting('app.clinica_id')::int) AS n_agendamentos,
            (SELECT count(*)::int FROM prontuario_entradas pr
              WHERE pr.paciente_id = p.id AND pr.expurgado = false)         AS n_prontuario
       FROM pacientes p
      WHERE p.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export interface MergeCounts {
  agendamentos: number;
  prontuario: number;
}

/**
 * Merge LÓGICO (DRAFT-checkin-ux.md §MERGE): move o histórico (agendamentos +
 * prontuário) da `origem` p/ o `destino` e marca a origem como `mesclado`
 * (mesclado_para_id). Nada é apagado — append-only/auditável e reversível à mão.
 * O trigger append-only do prontuário NÃO bloqueia troca de `paciente_id` (só guarda
 * campos de conteúdo). Deve rodar dentro de UMA `withTenant` (atômico).
 */
export async function mesclar(
  tx: Tx,
  destinoId: number,
  origemId: number
): Promise<MergeCounts> {
  const ag = await tx.query(
    `UPDATE agendamentos_sofia_demo
        SET paciente_id = $1
      WHERE paciente_id = $2
        AND clinica_id = current_setting('app.clinica_id')::int`,
    [destinoId, origemId]
  );
  const pr = await tx.query(
    `UPDATE prontuario_entradas SET paciente_id = $1 WHERE paciente_id = $2`,
    [destinoId, origemId]
  );
  await tx.query(
    `UPDATE pacientes
        SET status = 'mesclado', mesclado_para_id = $1, atualizado_em = NOW()
      WHERE id = $2`,
    [destinoId, origemId]
  );
  return { agendamentos: ag.rowCount ?? 0, prontuario: pr.rowCount ?? 0 };
}

/** Ficha mínima por id (RLS garante que só vem se for da clínica da sessão). */
export async function obterPorId(tx: Tx, id: number) {
  const { rows } = await tx.query(
    `SELECT id, clinica_id, nome_completo,
            to_char(data_nascimento,'YYYY-MM-DD') AS data_nascimento,
            date_part('year', age(data_nascimento))::int AS idade,
            fn_e_menor(data_nascimento) AS e_menor,
            cpf_last4, status, to_char(criado_em,'YYYY-MM-DD') AS criado_em
       FROM pacientes WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}
