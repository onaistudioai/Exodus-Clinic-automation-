import type { Tx } from "@/lib/db";
import {
  solicitarAprovacaoPacientePg,
  type SolicitarAprovacaoPaciente,
} from "@/server/solicitacao-paciente.repo";

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
 * W2e (2026-09-01) — número reciclado herda acesso ao dono anterior.
 *
 * `contatos_whatsapp.status`/`verificado_em` existem desde
 * DRAFT-prontuario-modelo.sql e nenhum código de app os lia. `resolverIdentidadeConfiavel`
 * fecha isso: só resolve paciente quando o CONTATO (não só o paciente) está
 * confiável. Ver fn_contato_confiavel em 003-reconfirmacao.sql para a regra.
 *
 * `desconhecido` cobre "não achou" E "achou mais de um" — mesma decisão de
 * resolverPacientePorTelefone, e pelo mesmo motivo: ambiguidade nunca deve
 * degradar para "escolhe o primeiro" quando o resultado é dado de saúde.
 *
 * `a_reconfirmar` carrega só o que o CALLER (sofia-paciente.ts) precisa para
 * abrir o escalonamento — chatId e clinicaId. Nome e pacienteId ficam de fora
 * DE PROPÓSITO: a SOFIA nunca pode confirmar "existe cadastro" para um contato
 * nesse estado, e o dado mais barato de vazar sem querer é o que nem existe no
 * tipo.
 */
export type ResolucaoIdentidade =
  | { tipo: "desconhecido" }
  | { tipo: "a_reconfirmar"; chatId: string; clinicaId: number }
  | { tipo: "ok"; paciente: PacienteIdentificado };

async function resolverContatoTitular(
  tx: Tx,
  telefoneE164: string
): Promise<{
  pacienteId: number;
  nome: string;
  chatId: string;
  clinicaId: number;
  confiavel: boolean;
} | null> {
  // fn_identidade_bootstrap: SECURITY DEFINER de propósito (acesso-007-identidade-
  // bootstrap.sql). Neste ponto app.paciente_id ainda NÃO existe — é esta consulta
  // que o descobre — então uma leitura direta de `pacientes` sob RESTRICTIVE
  // rls_paciente_whatsapp negaria sempre (deadlock achado no GATE A+B). A função
  // reproduz o filtro de clinica_id manualmente (DEFINER também ignora RLS de
  // tenant) e devolve só o mínimo — mesmo padrão de fn_login_lookup.
  const { rows } = await tx.query<{
    paciente_id: number;
    nome_completo: string;
    chat_id: string;
    clinica_id: number;
    confiavel: boolean;
  }>(`SELECT * FROM fn_identidade_bootstrap($1)`, [telefoneE164]);

  if (rows.length !== 1) return null;
  return {
    pacienteId: rows[0].paciente_id,
    nome: rows[0].nome_completo,
    chatId: rows[0].chat_id,
    clinicaId: rows[0].clinica_id,
    confiavel: rows[0].confiavel,
  };
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
 *
 * NÃO olha confiabilidade do contato — de propósito. Usada por
 * /api/sofia/optout, que precisa achar o chat_id de QUALQUER contato vinculado
 * para poder revogar consentimento (art. 8º §5 LGPD: sair tem que ser fácil).
 * O fluxo que revela dado de paciente usa resolverIdentidadeConfiavel abaixo.
 */
export async function resolverPacientePorTelefone(
  tx: Tx,
  telefoneE164: string
): Promise<PacienteIdentificado | null> {
  const contato = await resolverContatoTitular(tx, telefoneE164);
  if (!contato) return null;
  return { pacienteId: contato.pacienteId, nome: contato.nome, chatId: contato.chatId };
}

/**
 * Mesma resolução de resolverPacientePorTelefone, mas discrimina o estado do
 * CONTATO. É a que o gate de identidade (sofia-paciente.ts) deve usar — ver
 * comentário de ResolucaoIdentidade acima para o motivo de cada variante.
 */
export async function resolverIdentidadeConfiavel(
  tx: Tx,
  telefoneE164: string
): Promise<ResolucaoIdentidade> {
  const contato = await resolverContatoTitular(tx, telefoneE164);
  if (!contato) return { tipo: "desconhecido" };
  if (!contato.confiavel) {
    return { tipo: "a_reconfirmar", chatId: contato.chatId, clinicaId: contato.clinicaId };
  }
  return {
    tipo: "ok",
    paciente: { pacienteId: contato.pacienteId, nome: contato.nome, chatId: contato.chatId },
  };
}

/**
 * Carimba a reconfirmação HUMANA no balcão — o único caminho que tira um
 * contato de 'a_reconfirmar'. Conversar com a SOFIA nunca chama esta função:
 * é exatamente o furo que o desenho existe para fechar (ver 003-reconfirmacao.sql).
 */
export async function reconfirmarContato(tx: Tx, chatId: string): Promise<boolean> {
  const res = await tx.query(
    `UPDATE contatos_whatsapp
        SET status = 'ativo', verificado_em = now()
      WHERE chat_id = $1
        AND clinica_id = current_setting('app.clinica_id')::int`,
    [chatId]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Segunda prova de identidade: data de nascimento.
 *
 * Compara no BANCO (`= $2::date`) em vez de trazer a data e comparar no app —
 * assim a data de nascimento nunca sai do banco por esta via. Um atacante que
 * chute errado recebe apenas `false`, sem nenhum dado de volta.
 *
 * Freio de força bruta: não mora aqui, mora em freio-identidade.repo.ts,
 * chamado pelo gate compartilhado em src/lib/sofia-paciente.ts
 * (identificarPaciente). Esta função continua pura — só compara.
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
 * W2f (2026-09-01) — nível de autorização (.planning/identidade/sql/005-nivel-autorizacao.sql).
 *
 * O MODELO: o telefone resolve QUEM FALA (acima, inalterado); o `nivel` do
 * vínculo decide EM NOME DE QUEM e ATÉ ONDE. Cada capacidade da SOFIA declara
 * o mínimo que exige, no mesmo espírito de `acao.sensivel` do módulo `acesso`.
 */
export const NIVEIS_AUTORIZACAO = ["nenhum", "agendar", "agendar_e_consultar", "total"] as const;
export type NivelAutorizacao = (typeof NIVEIS_AUTORIZACAO)[number];

const ORDEM_NIVEL: Record<NivelAutorizacao, number> = {
  nenhum: 0,
  agendar: 1,
  agendar_e_consultar: 2,
  total: 3,
};

function nivelAtende(nivel: NivelAutorizacao, minimo: NivelAutorizacao): boolean {
  return ORDEM_NIVEL[nivel] >= ORDEM_NIVEL[minimo];
}

/**
 * Nível + chatId do vínculo TITULAR do paciente — a MESMA resolução usada
 * para identificar o falante (resolverContatoTitular), lida de novo pelo
 * pacienteId em vez do telefone. `null` sem vínculo titular (não deveria
 * acontecer — todo paciente ativo tem um).
 *
 * Não recebe chatId como PARÂMETRO de propósito: mantém a assinatura das duas
 * funções abaixo idêntica à de antes desta fase, então nenhuma rota precisou
 * mudar a chamada — o gate de nível viaja DENTRO da função. O chatId é
 * devolvido (não recebido) para W2g poder abrir um pedido de aprovação sem
 * uma segunda consulta.
 */
async function vinculoTitularDoPaciente(
  tx: Tx,
  pacienteId: number
): Promise<{ nivel: NivelAutorizacao; chatId: string } | null> {
  const { rows } = await tx.query<{ nivel: NivelAutorizacao; chat_id: string }>(
    `SELECT pc.nivel, c.chat_id
       FROM paciente_contato pc
       JOIN contatos_whatsapp c ON c.id = pc.contato_id
      WHERE pc.paciente_id = $1
        AND pc.papel = 'titular'
        AND pc.revogado_em IS NULL
        AND pc.clinica_id = current_setting('app.clinica_id')::int
      LIMIT 1`,
    [pacienteId]
  );
  if (rows.length === 0) return null;
  return { nivel: rows[0].nivel, chatId: rows[0].chat_id };
}

/**
 * Clínica do paciente — usado só para abrir um pedido de aprovação a partir
 * de dentro de uma tx já tenant-scoped (a porta injetável exige clinicaId
 * explícito, mesmo padrão de EscalonarReconfirmacao na Fase 2).
 */
export async function clinicaAtual(tx: Tx): Promise<number> {
  const { rows } = await tx.query<{ clinica_id: string }>(
    "SELECT current_setting('app.clinica_id') AS clinica_id"
  );
  return Number(rows[0].clinica_id);
}

/** fn_e_menor já existe desde DRAFT-prontuario-modelo.sql — só chama. */
export async function ehMenor(tx: Tx, pacienteId: number): Promise<boolean> {
  const { rows } = await tx.query<{ menor: boolean }>(
    `SELECT fn_e_menor(data_nascimento) AS menor FROM pacientes WHERE id = $1`,
    [pacienteId]
  );
  return rows[0]?.menor === true;
}

/**
 * Muda o status de um agendamento **do próprio paciente**.
 *
 * O `paciente_id` entra no WHERE, não numa checagem antes do UPDATE: assim não
 * existe janela entre verificar e agir, e um id de agendamento alheio
 * simplesmente não casa (rowCount 0). É a defesa contra IDOR — a SOFIA recebe
 * o número do agendamento do paciente, que é adivinhável.
 *
 * Exige nível `agendar` — fail-closed: `nenhum` (balcão restringiu, ou vínculo
 * não-titular sem concessão) devolve `false` sem tentar o UPDATE. Em vez de só
 * negar e encerrar (W2g), abre um pedido de aprovação — motivo
 * `nivel_insuficiente` — para o balcão decidir, em vez do pedido morrer ali.
 */
export async function mudarStatusDoPaciente(
  tx: Tx,
  pacienteId: number,
  agendamentoId: number,
  status: "confirmada" | "cancelada",
  solicitar: SolicitarAprovacaoPaciente = solicitarAprovacaoPacientePg
): Promise<boolean> {
  const vinculo = await vinculoTitularDoPaciente(tx, pacienteId);
  if (!vinculo || !nivelAtende(vinculo.nivel, "agendar")) {
    if (vinculo) {
      await solicitar.abrir(await clinicaAtual(tx), {
        chatId: vinculo.chatId,
        pacienteId,
        motivo: "nivel_insuficiente",
        acaoPretendida: "mudar_status_agendamento",
        argumentos: { agendamentoId, status },
      });
    }
    return false;
  }

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
 *
 * Exige nível `agendar_e_consultar` — mais alto que mudarStatusDoPaciente:
 * ver a agenda é mais informação do que só confirmar/cancelar o que já
 * chegou por outro canal. Mesmo desvio para pedido de aprovação (W2g) do que
 * mudarStatusDoPaciente.
 */
export async function proximosAgendamentosDoPaciente(
  tx: Tx,
  pacienteId: number,
  solicitar: SolicitarAprovacaoPaciente = solicitarAprovacaoPacientePg
): Promise<Array<{ inicio: string; servico: string; profissional: string; status: string }>> {
  const vinculo = await vinculoTitularDoPaciente(tx, pacienteId);
  if (!vinculo || !nivelAtende(vinculo.nivel, "agendar_e_consultar")) {
    if (vinculo) {
      await solicitar.abrir(await clinicaAtual(tx), {
        chatId: vinculo.chatId,
        pacienteId,
        motivo: "nivel_insuficiente",
        acaoPretendida: "ver_proximos_agendamentos",
      });
    }
    return [];
  }

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

/**
 * Alcance completo de um CONTATO: todos os pacientes que ele pode tocar, com
 * papel e nível — não só o vínculo titular. É o que torna "a filha agenda
 * pela mãe" possível: o contato dela tem uma linha `titular` para o próprio
 * registro e uma `autorizado` para o da mãe, cada uma com seu nível.
 *
 * NÃO usada ainda por nenhuma rota — a SOFIA hoje só age sobre o vínculo
 * titular resolvido (resolverIdentidadeConfiavel), e nenhuma das rotas
 * /api/sofia/* aceita "aja sobre ESTE OUTRO paciente" como parâmetro. Escrita
 * porque a Fase 3 pediu o dado disponível; decidir COMO a SOFIA oferece "agir
 * em nome de outro paciente" (que rota, que campo, que confirmação) é decisão
 * de protocolo que esta fase não especificou o suficiente para implementar
 * com segurança — fica de fora de propósito, não por esquecimento.
 */
export interface AlcanceItem {
  pacienteId: number;
  nome: string;
  papel: "titular" | "responsavel" | "autorizado";
  nivel: NivelAutorizacao;
}

export async function listarAlcanceDoContato(tx: Tx, chatId: string): Promise<AlcanceItem[]> {
  const { rows } = await tx.query<{
    paciente_id: number;
    nome_completo: string;
    papel: "titular" | "responsavel" | "autorizado";
    nivel: NivelAutorizacao;
  }>(
    `SELECT p.id AS paciente_id, p.nome_completo, pc.papel, pc.nivel
       FROM contatos_whatsapp c
       JOIN paciente_contato pc ON pc.contato_id = c.id AND pc.clinica_id = c.clinica_id
       JOIN pacientes p ON p.id = pc.paciente_id
      WHERE c.chat_id = $1
        AND pc.revogado_em IS NULL
        AND p.status = 'ativo'`,
    [chatId]
  );
  return rows.map((r) => ({
    pacienteId: r.paciente_id,
    nome: r.nome_completo,
    papel: r.papel,
    nivel: r.nivel,
  }));
}

/**
 * Vínculos de um paciente, para a tela da recepção (pacientes/[id]) conceder
 * nível. Owner do lado do PACIENTE (não do contato) porque é essa a tela que
 * existe — "sem tela nova" pedia reusar a ficha do paciente.
 */
export interface VinculoDoPaciente {
  contatoId: number;
  chatId: string;
  telefone: string | null;
  papel: "titular" | "responsavel" | "autorizado";
  nivel: NivelAutorizacao;
}

export async function listarVinculosDoPaciente(
  tx: Tx,
  pacienteId: number
): Promise<VinculoDoPaciente[]> {
  const { rows } = await tx.query<{
    contato_id: number;
    chat_id: string;
    telefone: string | null;
    papel: "titular" | "responsavel" | "autorizado";
    nivel: NivelAutorizacao;
  }>(
    `SELECT c.id AS contato_id, c.chat_id, c.telefone, pc.papel, pc.nivel
       FROM paciente_contato pc
       JOIN contatos_whatsapp c ON c.id = pc.contato_id
      WHERE pc.paciente_id = $1
        AND pc.revogado_em IS NULL
      ORDER BY pc.titular DESC, pc.confirmado_em`,
    [pacienteId]
  );
  return rows.map((r) => ({
    contatoId: r.contato_id,
    chatId: r.chat_id,
    telefone: r.telefone,
    papel: r.papel,
    nivel: r.nivel,
  }));
}

/**
 * ÚNICO caminho para um vínculo NÃO-titular ganhar nível — ato humano no
 * balcão (`requireAcao("checkin")` no caller). Nível nunca sobe por
 * autoatendimento no WhatsApp: é a linha que impede "eu digito que sou a mãe
 * dela" de virar poder.
 */
export async function definirNivel(
  tx: Tx,
  contatoId: number,
  pacienteId: number,
  nivel: NivelAutorizacao
): Promise<boolean> {
  const res = await tx.query(
    `UPDATE paciente_contato
        SET nivel = $3
      WHERE contato_id = $1
        AND paciente_id = $2
        AND revogado_em IS NULL
        AND clinica_id = current_setting('app.clinica_id')::int`,
    [contatoId, pacienteId, nivel]
  );
  return (res.rowCount ?? 0) > 0;
}
