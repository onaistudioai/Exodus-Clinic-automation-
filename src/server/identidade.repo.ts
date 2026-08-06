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
 * O vínculo telefone→paciente usa o mesmo join de `marcarOptout()`
 * (src/server/reativacao.repo.ts): contatos_whatsapp × paciente_contato, filtrando
 * por titular e por vínculo não revogado. A clínica sai da RLS, não do WHERE.
 */

export interface PacienteIdentificado {
  pacienteId: number;
  nome: string;
  chatId: string;
}

/**
 * Resolve o paciente a partir do telefone (E.164). A RLS já restringe à clínica
 * da sessão, então o mesmo número em duas clínicas não se confunde.
 *
 * Só o vínculo TITULAR resolve. Um número pode ser contato de vários pacientes
 * (mãe que agenda para os filhos); nesse caso, responder pelo "primeiro" seria
 * entregar dado de saúde de terceiro. O titular é único por número, e dependente
 * precisa ser tratado por fluxo próprio — hoje cai no atendimento humano.
 *
 * Retorna null se não achar OU se achar mais de um: ambiguidade nunca deve
 * resolver em "escolhe o primeiro" quando o resultado é dado de saúde.
 */
export async function resolverPacientePorTelefone(
  tx: Tx,
  telefoneE164: string
): Promise<PacienteIdentificado | null> {
  const { rows } = await tx.query<{
    paciente_id: number;
    nome_completo: string;
    chat_id: string;
  }>(
    `SELECT p.id AS paciente_id, p.nome_completo, c.chat_id
       FROM contatos_whatsapp c
       JOIN paciente_contato pc
         ON pc.contato_id = c.id AND pc.clinica_id = c.clinica_id
       JOIN pacientes p ON p.id = pc.paciente_id
      WHERE c.telefone = $1
        AND pc.titular = true
        AND pc.revogado_em IS NULL
        AND p.status = 'ativo'
      LIMIT 2`,
    [telefoneE164]
  );

  if (rows.length !== 1) return null;
  return {
    pacienteId: rows[0].paciente_id,
    nome: rows[0].nome_completo,
    chatId: rows[0].chat_id,
  };
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
 * Muda o status de um agendamento **do próprio paciente**.
 *
 * O `paciente_id` entra no WHERE, não numa checagem antes do UPDATE: assim não
 * existe janela entre verificar e agir, e um id de agendamento alheio
 * simplesmente não casa (rowCount 0). É a defesa contra IDOR — a SOFIA recebe
 * o número do agendamento do paciente, que é adivinhável.
 */
export async function mudarStatusDoPaciente(
  tx: Tx,
  pacienteId: number,
  agendamentoId: number,
  status: "confirmada" | "cancelada"
): Promise<boolean> {
  const res = await tx.query(
    `UPDATE agendamentos_sofia_demo
        SET status = $3
      WHERE id = $2
        AND paciente_id = $1
        AND clinica_id = current_setting('app.clinica_id')::int
        AND inicio >= now()
        AND status NOT IN ('realizada', 'cancelada')`,
    [pacienteId, agendamentoId, status]
  );
  return (res.rowCount ?? 0) > 0;
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
    // clinica_id explícito: agendamentos_sofia_demo é a ÚNICA tabela multi-tenant
    // sem RLS (writer legado da SOFIA quebraria com FORCE). Aqui a RLS não cobre,
    // então o filtro é obrigatório — mesma convenção de reativacao.repo.ts.
    `SELECT inicio, servico, profissional, status
       FROM agendamentos_sofia_demo
      WHERE clinica_id = current_setting('app.clinica_id')::int
        AND paciente_id = $1
        AND inicio >= now()
        AND status <> 'cancelado'
      ORDER BY inicio
      LIMIT 5`,
    [pacienteId]
  );
  return rows;
}
