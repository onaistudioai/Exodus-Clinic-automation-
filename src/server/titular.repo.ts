import "server-only";
import { pool, type Tx } from "@/lib/db";

/**
 * DAL — Direitos do titular (LGPD art. 18). Ver `.planning/seguranca/005-titular.sql`.
 *
 * Duas operações, dois artigos:
 *   dossie()  -> art. 18 II e V (acesso e portabilidade). Só lê.
 *   eliminar() -> art. 18 VI (eliminação), delegado a fn_titular_eliminar, que
 *                respeita o art. 16, I (guarda por obrigação legal).
 *
 * Toda query filtra por clinica_id do GUC — redundante com a RLS FORCE e
 * proposital (padrão da casa).
 *
 * Seção que falha devolve null, igual ao conformidade.repo: num documento
 * entregue ao titular, "não temos esse dado" e "o módulo não está migrado" não
 * podem se passar por "está vazio".
 */

export interface DossieTitular {
  gerado_em: string;
  identificacao: {
    id: number;
    nome_completo: string;
    data_nascimento: string;
    cpf_last4: string | null;
    status: string;
    criado_em: string;
    eliminacao_pedida_em: string | null;
    anonimizado_em: string | null;
  } | null;
  contatos: Array<{
    telefone: string | null;
    vinculo_status: string;
    titular: boolean;
    marketing_optin: boolean | null;
    confirmado_em: string | null;
  }> | null;
  consentimentos: Array<{
    tipo: string;
    origem: string;
    evidencia: string | null;
    registrado_em: string;
  }> | null;
  agendamentos: Array<{
    data: string;
    hora: string;
    servico: string | null;
    profissional: string | null;
    status: string;
  }> | null;
  prontuario: Array<{
    id: number;
    tipo_atendimento: string | null;
    texto_clinico: string | null;
    orientacoes_paciente: string | null;
    expurgado: boolean;
    criado_em: string;
  }> | null;
  cobrancas: Array<{
    valor: string;
    vencimento: string;
    status: string;
    forma_pagamento: string | null;
    pago_em: string | null;
  }> | null;
  reativacao: Array<{
    campanha: string | null;
    status: string;
    entrou_em: string | null;
    mensagens_enviadas: number;
  }> | null;
  quem_acessou: Array<{
    usuario_nome: string | null;
    usuario_papel: string | null;
    acao: string;
    criado_em: string;
  }> | null;
}

/** Executa a seção e devolve null se a tabela não existir (módulo não migrado). */
async function secao<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

const TENANT = `current_setting('app.clinica_id')::int`;
const TS = (c: string) => `to_char(${c},'YYYY-MM-DD"T"HH24:MI:SS')`;

/**
 * Dossiê completo de um titular, para entregar em resposta a pedido de acesso.
 *
 * Inclui o texto clínico: o titular tem direito de acesso ao próprio prontuário.
 * Quem decide se PODE gerar é o RBAC na camada de cima (`ler_texto_clinico`), e a
 * geração é auditada — pedido de titular não é porta lateral para a recepção ler
 * o que não pode.
 *
 * NÃO inclui `crm_tarefas` nem `escalonamentos`: são anotações operacionais
 * internas da clínica sobre o atendimento, não dado fornecido pelo titular.
 * Se o titular pedir especificamente, a clínica avalia caso a caso.
 */
export async function dossie(tx: Tx, pacienteId: number): Promise<DossieTitular> {
  const identificacao = await secao(async () => {
    const { rows } = await tx.query(
      `SELECT id, nome_completo,
              to_char(data_nascimento,'YYYY-MM-DD')       AS data_nascimento,
              cpf_last4, status,
              ${TS("criado_em")}                          AS criado_em,
              ${TS("eliminacao_pedida_em")}               AS eliminacao_pedida_em,
              ${TS("anonimizado_em")}                     AS anonimizado_em
         FROM pacientes
        WHERE id = $1 AND clinica_id = ${TENANT}`,
      [pacienteId]
    );
    return rows[0] ?? null;
  });

  const contatos = await secao(async () => {
    const { rows } = await tx.query(
      `SELECT c.telefone, pc.vinculo_status, pc.titular, c.marketing_optin,
              ${TS("pc.confirmado_em")} AS confirmado_em
         FROM paciente_contato pc
         JOIN contatos_whatsapp c ON c.id = pc.contato_id AND c.clinica_id = ${TENANT}
        WHERE pc.paciente_id = $1 AND pc.clinica_id = ${TENANT}
        ORDER BY pc.confirmado_em`,
      [pacienteId]
    );
    return rows;
  });

  const consentimentos = await secao(async () => {
    const { rows } = await tx.query(
      `SELECT ce.tipo, ce.origem, ce.evidencia,
              ${TS("ce.registrado_em")} AS registrado_em
         FROM consentimento_eventos ce
         JOIN paciente_contato pc ON pc.contato_id = ce.contato_id AND pc.clinica_id = ${TENANT}
        WHERE pc.paciente_id = $1 AND ce.clinica_id = ${TENANT}
        ORDER BY ce.registrado_em`,
      [pacienteId]
    );
    return rows;
  });

  const agendamentos = await secao(async () => {
    const { rows } = await tx.query(
      `SELECT to_char(data_agendamento,'YYYY-MM-DD') AS data,
              to_char(hora_agendamento,'HH24:MI')    AS hora,
              servico, profissional, status
         FROM agendamentos_sofia_demo
        WHERE paciente_id = $1 AND clinica_id = ${TENANT}
        ORDER BY data_agendamento DESC`,
      [pacienteId]
    );
    return rows;
  });

  // EXCEÇÃO VIGIADA: único acesso direto a `prontuario_entradas` fora de
  // prontuario.repo. A fronteira (v_prontuario_visivel) não serve aqui por
  // construção — ela existe justamente para NÃO expor texto_clinico, e o art. 18
  // da LGPD obriga a devolver o texto ao próprio titular. Não trocar pela view.
  const prontuario = await secao(async () => {
    const { rows } = await tx.query(
      `SELECT id, tipo_atendimento, texto_clinico, orientacoes_paciente, expurgado,
              ${TS("criado_em")} AS criado_em
         FROM prontuario_entradas
        WHERE paciente_id = $1 AND clinica_id = ${TENANT} AND estado = 'finalizado'
        ORDER BY criado_em DESC`,
      [pacienteId]
    );
    return rows;
  });

  const cobrancas = await secao(async () => {
    const { rows } = await tx.query(
      `SELECT valor::text, to_char(vencimento,'YYYY-MM-DD') AS vencimento,
              status, forma_pagamento, ${TS("pago_em")} AS pago_em
         FROM financeiro_cobrancas
        WHERE paciente_id = $1 AND clinica_id = ${TENANT}
        ORDER BY vencimento DESC`,
      [pacienteId]
    );
    return rows;
  });

  const reativacao = await secao(async () => {
    const { rows } = await tx.query(
      `SELECT ca.nome AS campanha, ra.status,
              ${TS("ra.entrou_em")} AS entrou_em,
              (SELECT count(*)::int FROM reativacao_envios e
                WHERE e.alvo_id = ra.id AND e.modo = 'live') AS mensagens_enviadas
         FROM reativacao_alvos ra
         LEFT JOIN reativacao_campanhas ca ON ca.id = ra.campanha_id
        WHERE ra.paciente_id = $1 AND ra.clinica_id = ${TENANT}
        ORDER BY ra.entrou_em DESC`,
      [pacienteId]
    );
    return rows;
  });

  const quem_acessou = await secao(async () => {
    const { rows } = await tx.query(
      `SELECT u.nome AS usuario_nome, u.papel AS usuario_papel, a.acao,
              ${TS("a.criado_em")} AS criado_em
         FROM prontuario_acessos a
         LEFT JOIN usuarios u ON u.id = a.usuario_id
        WHERE a.paciente_id = $1 AND a.clinica_id = ${TENANT}
        ORDER BY a.criado_em DESC
        LIMIT 500`,
      [pacienteId]
    );
    return rows;
  });

  return {
    gerado_em: new Date().toISOString(),
    identificacao: identificacao as DossieTitular["identificacao"],
    contatos: contatos as DossieTitular["contatos"],
    consentimentos: consentimentos as DossieTitular["consentimentos"],
    agendamentos: agendamentos as DossieTitular["agendamentos"],
    prontuario: prontuario as DossieTitular["prontuario"],
    cobrancas: cobrancas as DossieTitular["cobrancas"],
    reativacao: reativacao as DossieTitular["reativacao"],
    quem_acessou: quem_acessou as DossieTitular["quem_acessou"],
  };
}

/** Recibo de eliminação — o que saiu, o que ficou retido e até quando. */
export interface ReciboEliminacao {
  paciente_id: number;
  pedido_em: string;
  ja_havia_pedido: boolean;
  vinculos_revogados: number;
  optouts_registrados: number;
  prontuarios_retidos: number;
  retencao_legal_ate: string | null;
  base_da_retencao: string;
}

/**
 * Art. 18 VI. Toda a lógica vive em fn_titular_eliminar (SQL) porque são cinco
 * escritas que precisam ser atômicas com a leitura do prazo legal — e porque o
 * mesmo pedido tem que poder chegar pela SOFIA depois, sem reimplementar a regra.
 */
export async function eliminar(
  tx: Tx,
  pacienteId: number,
  motivo: string,
  usuarioId: number
): Promise<ReciboEliminacao> {
  const { rows } = await tx.query<{ recibo: ReciboEliminacao }>(
    `SELECT fn_titular_eliminar($1, $2, $3) AS recibo`,
    [pacienteId, motivo, usuarioId]
  );
  return rows[0].recibo;
}

/**
 * Expurgo por retenção (cron). Devolve o que foi expurgado por alvo.
 *
 * Roda FORA do withTenant() de propósito: prazo legal não é multi-tenant, e a
 * função percorre as clínicas por conta própria. É a única operação do painel que
 * não tem tenant — por isso só o cron a alcança (ver a rota).
 */
export async function expurgoRetencao(): Promise<
  Array<{ alvo: string; afetados: number }>
> {
  const { rows } = await pool.query<{ alvo: string; afetados: number }>(
    `SELECT alvo, afetados FROM fn_expurgo_retencao()`
  );
  return rows;
}
