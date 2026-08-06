import type { Tx } from "@/lib/db";

/**
 * W2d — Identidade do paciente no canal WhatsApp.
 *
 * O PROBLEMA: não existe login de paciente. O único identificador é o número de
 * telefone, e telefone é fraco — número reciclado pela operadora, chip clonado,
 * aparelho emprestado. Entregar histórico de saúde só com base nele é vazamento
 * esperando acontecer.
 *
 * O DESENHO: o paciente é sempre DERIVADO do telefone da conversa, nunca informado
 * por parâmetro (mesma regra do clinica_id em withTenant). E antes de revelar
 * qualquer informação, exige-se uma segunda prova: a data de nascimento.
 *
 * ⚠️ SCHEMA A CONFIRMAR: a tabela `contatos` pertence ao schema A4 (PROC-A) e não
 * está versionada neste repositório. As colunas usadas abaixo (telefone,
 * paciente_id) precisam ser conferidas contra o banco vivo antes do primeiro
 * deploy — rodar `.planning/estoque/sql/inspect-bella.sql` ou `\d contatos`.
 */

export interface PacienteIdentificado {
  pacienteId: number;
  nome: string;
}

/**
 * Resolve o paciente a partir do telefone (E.164). A RLS já restringe à clínica
 * da sessão, então dois pacientes de clínicas diferentes com o mesmo número não
 * se confundem.
 *
 * Retorna null se não achar OU se achar mais de um: ambiguidade nunca deve
 * resolver em "escolhe o primeiro" quando o resultado é dado de saúde.
 */
export async function resolverPacientePorTelefone(
  tx: Tx,
  telefoneE164: string
): Promise<PacienteIdentificado | null> {
  const { rows } = await tx.query<{ paciente_id: number; nome_completo: string }>(
    `SELECT p.id AS paciente_id, p.nome_completo
       FROM contatos c
       JOIN pacientes p ON p.id = c.paciente_id
      WHERE c.telefone = $1
        AND p.status = 'ativo'
      LIMIT 2`,
    [telefoneE164]
  );

  if (rows.length !== 1) return null;
  return { pacienteId: rows[0].paciente_id, nome: rows[0].nome_completo };
}

/**
 * Segunda prova de identidade: data de nascimento.
 *
 * Compara no BANCO (`= $2::date`) em vez de trazer a data e comparar no app —
 * assim a data de nascimento nunca sai do banco por esta via. Um atacante que
 * chute errado recebe apenas `false`, sem nenhum dado de volta.
 *
 * ponytail: sem rate limit próprio ainda. A SOFIA deve encerrar a conversa após
 * 3 tentativas na mesma sessão; se virar vetor real, migrar o contador para cá.
 */
export async function confirmarIdentidade(
  tx: Tx,
  pacienteId: number,
  dataNascimentoISO: string
): Promise<boolean> {
  const { rows } = await tx.query<{ ok: boolean }>(
    `SELECT (data_nascimento = $2::date) AS ok
       FROM pacientes
      WHERE id = $1`,
    [pacienteId, dataNascimentoISO]
  );
  return rows[0]?.ok === true;
}

/**
 * Próximos agendamentos do paciente — o MÍNIMO que a SOFIA precisa para atender.
 *
 * Note o que NÃO volta: prontuário, anotação clínica, valor, histórico de
 * procedimento. Só o que responde "quando é minha consulta". Minimização (art. 6º
 * III da LGPD) aplicada no SELECT, não na camada de cima — assim nenhum caller
 * consegue pedir mais por engano.
 */
export async function proximosAgendamentosDoPaciente(
  tx: Tx,
  pacienteId: number
): Promise<Array<{ inicio: string; servico: string; profissional: string; status: string }>> {
  const { rows } = await tx.query(
    `SELECT inicio, servico, profissional, status
       FROM agendamentos_sofia_demo
      WHERE paciente_id = $1
        AND inicio >= now()
        AND status <> 'cancelado'
      ORDER BY inicio
      LIMIT 5`,
    [pacienteId]
  );
  return rows;
}
