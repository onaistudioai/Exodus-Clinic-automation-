import "server-only";
import type { Tx } from "@/lib/db";
import type {
  Profissional,
  Servico,
  Turno,
  Bloqueio,
  SlotLivre,
  AgendamentoDia,
  IndicadoresAgenda,
  DiaSemana,
} from "@/types/domain";

/**
 * DAL — Agenda + Turnos (Módulo Agenda, OPUS). Tabelas novas têm RLS FORCE por clinica_id;
 * `agendamentos_sofia_demo` TAMBÉM tem RLS agora (K1: writer SOFIA = app_n8n BYPASSRLS, não quebra).
 * GUC `app.clinica_id` setado por withTenant(). A camada de Action aplica o RBAC.
 *
 * Decisões D1–D6: duração por serviço; profissional = entidade; disponibilidade = turno−bloqueio−
 * agendamento; anti-overbooking pela exclusion constraint `no_overbooking` (traduzida aqui em erro
 * amigável); fonte única `agendamentos_sofia_demo` (mantém data/hora legados p/ os lembretes n8n).
 * Tempo: inicio/fim são timestamptz; turnos guardam hora local — conversão no fuso da clínica.
 */

const TZ = `(SELECT timezone FROM clinicas WHERE id = current_setting('app.clinica_id')::int)`;

// ===========================================================================
// PROFISSIONAIS
// ===========================================================================

export async function listarProfissionais(
  tx: Tx,
  incluirInativos = false
): Promise<Profissional[]> {
  const { rows } = await tx.query<Profissional>(
    `SELECT id, clinica_id, nome, especialidade, usuario_id, ativo,
            to_char(criado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em
       FROM profissionais
      WHERE clinica_id = current_setting('app.clinica_id')::int
        AND ($1 OR ativo = true)
      ORDER BY ativo DESC, nome`,
    [incluirInativos]
  );
  return rows;
}

export async function criarProfissional(
  tx: Tx,
  p: { nome: string; especialidade: string | null; usuarioId: number | null }
): Promise<number> {
  const { rows } = await tx.query<{ id: number }>(
    `INSERT INTO profissionais (clinica_id, nome, especialidade, usuario_id)
     VALUES (current_setting('app.clinica_id')::int, $1, $2, $3) RETURNING id`,
    [p.nome, p.especialidade, p.usuarioId]
  );
  return rows[0].id;
}

export async function atualizarProfissional(
  tx: Tx,
  id: number,
  p: { nome: string; especialidade: string | null; usuarioId: number | null; ativo: boolean }
): Promise<void> {
  await tx.query(
    `UPDATE profissionais SET nome=$2, especialidade=$3, usuario_id=$4, ativo=$5
      WHERE id=$1 AND clinica_id = current_setting('app.clinica_id')::int`,
    [id, p.nome, p.especialidade, p.usuarioId, p.ativo]
  );
}

// ===========================================================================
// SERVIÇOS
// ===========================================================================

export async function listarServicos(tx: Tx, incluirInativos = false): Promise<Servico[]> {
  const { rows } = await tx.query<Servico>(
    `SELECT id, clinica_id, nome, duracao_min, ativo,
            to_char(criado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em
       FROM servicos
      WHERE clinica_id = current_setting('app.clinica_id')::int
        AND ($1 OR ativo = true)
      ORDER BY ativo DESC, nome`,
    [incluirInativos]
  );
  return rows;
}

export async function criarServico(
  tx: Tx,
  s: { nome: string; duracaoMin: number }
): Promise<number> {
  const { rows } = await tx.query<{ id: number }>(
    `INSERT INTO servicos (clinica_id, nome, duracao_min)
     VALUES (current_setting('app.clinica_id')::int, $1, $2)
     ON CONFLICT (clinica_id, lower(nome))
       DO UPDATE SET duracao_min = EXCLUDED.duracao_min, ativo = true
     RETURNING id`,
    [s.nome, s.duracaoMin]
  );
  return rows[0].id;
}

export async function atualizarServico(
  tx: Tx,
  id: number,
  s: { nome: string; duracaoMin: number; ativo: boolean }
): Promise<void> {
  await tx.query(
    `UPDATE servicos SET nome=$2, duracao_min=$3, ativo=$4
      WHERE id=$1 AND clinica_id = current_setting('app.clinica_id')::int`,
    [id, s.nome, s.duracaoMin, s.ativo]
  );
}

// ===========================================================================
// TURNOS (escala recorrente) + BLOQUEIOS
// ===========================================================================

export async function listarTurnos(tx: Tx): Promise<Turno[]> {
  const { rows } = await tx.query<Turno>(
    `SELECT t.id, t.clinica_id, t.profissional_id, p.nome AS profissional_nome,
            t.dia_semana, to_char(t.hora_inicio,'HH24:MI') AS hora_inicio,
            to_char(t.hora_fim,'HH24:MI') AS hora_fim,
            to_char(t.vigencia_inicio,'YYYY-MM-DD') AS vigencia_inicio,
            to_char(t.vigencia_fim,'YYYY-MM-DD') AS vigencia_fim,
            t.ativo, to_char(t.criado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em
       FROM turnos t
       JOIN profissionais p ON p.id = t.profissional_id
        AND p.clinica_id = current_setting('app.clinica_id')::int
      WHERE t.clinica_id = current_setting('app.clinica_id')::int
      ORDER BY t.profissional_id, t.dia_semana, t.hora_inicio`,
    []
  );
  return rows;
}

export async function criarTurno(
  tx: Tx,
  t: {
    profissionalId: number;
    diaSemana: DiaSemana;
    horaInicio: string;
    horaFim: string;
    vigenciaInicio: string;
    vigenciaFim: string | null;
  }
): Promise<number> {
  // valida que o profissional ∈ clínica (FK ignora RLS — lição M2 do Estoque)
  const { rows } = await tx.query<{ id: number }>(
    `INSERT INTO turnos
       (clinica_id, profissional_id, dia_semana, hora_inicio, hora_fim, vigencia_inicio, vigencia_fim)
     SELECT current_setting('app.clinica_id')::int, p.id, $2, $3::time, $4::time, $5::date, $6::date
       FROM profissionais p
      WHERE p.id = $1 AND p.clinica_id = current_setting('app.clinica_id')::int
     RETURNING id`,
    [t.profissionalId, t.diaSemana, t.horaInicio, t.horaFim, t.vigenciaInicio, t.vigenciaFim]
  );
  if (rows.length === 0) throw new Error("Profissional não encontrado nesta clínica.");
  return rows[0].id;
}

export async function removerTurno(tx: Tx, id: number): Promise<void> {
  await tx.query(
    `DELETE FROM turnos WHERE id=$1 AND clinica_id = current_setting('app.clinica_id')::int`,
    [id]
  );
}

export async function listarBloqueios(tx: Tx, desde: string): Promise<Bloqueio[]> {
  const { rows } = await tx.query<Bloqueio>(
    `SELECT b.id, b.clinica_id, b.profissional_id, p.nome AS profissional_nome,
            to_char(b.inicio,'YYYY-MM-DD"T"HH24:MI:SS') AS inicio,
            to_char(b.fim,'YYYY-MM-DD"T"HH24:MI:SS') AS fim, b.motivo,
            to_char(b.criado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em
       FROM bloqueios b
       LEFT JOIN profissionais p ON p.id = b.profissional_id
        AND p.clinica_id = current_setting('app.clinica_id')::int
      WHERE b.clinica_id = current_setting('app.clinica_id')::int
        AND b.fim >= $1::timestamptz
      ORDER BY b.inicio`,
    [desde]
  );
  return rows;
}

export async function criarBloqueio(
  tx: Tx,
  b: { profissionalId: number | null; inicio: string; fim: string; motivo: string | null }
): Promise<number> {
  const { rows } = await tx.query<{ id: number }>(
    `INSERT INTO bloqueios (clinica_id, profissional_id, inicio, fim, motivo)
     VALUES (current_setting('app.clinica_id')::int, $1, $2::timestamptz, $3::timestamptz, $4)
     RETURNING id`,
    [b.profissionalId, b.inicio, b.fim, b.motivo]
  );
  return rows[0].id;
}

export async function removerBloqueio(tx: Tx, id: number): Promise<void> {
  await tx.query(
    `DELETE FROM bloqueios WHERE id=$1 AND clinica_id = current_setting('app.clinica_id')::int`,
    [id]
  );
}

// ===========================================================================
// DISPONIBILIDADE — slots livres (D3/D6): turno − bloqueio − agendamento
// ===========================================================================

/**
 * Horários livres de um profissional num dia, em passos de `duracaoMin`.
 * Gera candidatos dentro das janelas dos turnos vigentes (no fuso da clínica) e exclui
 * os que colidem com bloqueios ou agendamentos não-cancelados. Tudo em SQL p/ evitar
 * bug de fuso (turnos guardam hora local; a clínica define o timezone).
 */
export async function slotsLivres(
  tx: Tx,
  profissionalId: number,
  data: string, // ISO date (local da clínica)
  duracaoMin: number
): Promise<SlotLivre[]> {
  const { rows } = await tx.query<SlotLivre>(
    `WITH janelas AS (
       SELECT ($2::date + t.hora_inicio) AT TIME ZONE ${TZ} AS win_inicio,
              ($2::date + t.hora_fim)    AT TIME ZONE ${TZ} AS win_fim
         FROM turnos t
        WHERE t.clinica_id = current_setting('app.clinica_id')::int
          AND t.profissional_id = $1 AND t.ativo
          AND t.dia_semana = extract(dow from $2::date)::int
          AND t.vigencia_inicio <= $2::date
          AND (t.vigencia_fim IS NULL OR t.vigencia_fim >= $2::date)
     ),
     candidatos AS (
       SELECT gs AS inicio, gs + ($3 || ' min')::interval AS fim
         FROM janelas j,
              generate_series(j.win_inicio, j.win_fim - ($3 || ' min')::interval,
                              ($3 || ' min')::interval) gs
     )
     SELECT $1 AS profissional_id,
            to_char(c.inicio,'YYYY-MM-DD"T"HH24:MI:SSOF') AS inicio,
            to_char(c.fim,'YYYY-MM-DD"T"HH24:MI:SSOF') AS fim,
            to_char(c.inicio AT TIME ZONE ${TZ},'HH24:MI') AS hora_label
       FROM candidatos c
      WHERE NOT EXISTS (
              SELECT 1 FROM bloqueios b
               WHERE b.clinica_id = current_setting('app.clinica_id')::int
                 AND (b.profissional_id = $1 OR b.profissional_id IS NULL)
                 AND tstzrange(b.inicio,b.fim,'[)') && tstzrange(c.inicio,c.fim,'[)'))
        AND NOT EXISTS (
              SELECT 1 FROM agendamentos_sofia_demo a
               WHERE a.clinica_id = current_setting('app.clinica_id')::int
                 AND a.profissional_id = $1
                 AND a.status NOT IN ('cancelada','no_show')
                 AND a.inicio IS NOT NULL AND a.fim IS NOT NULL
                 AND tstzrange(a.inicio,a.fim,'[)') && tstzrange(c.inicio,c.fim,'[)'))
      ORDER BY c.inicio`,
    [profissionalId, data, duracaoMin]
  );
  return rows;
}

// ===========================================================================
// AGENDAMENTOS — ops (fonte única; mantém data/hora legados p/ lembretes n8n)
// ===========================================================================

const SELECT_AGENDA_DIA = `
  a.id, a.clinica_id, a.paciente_id, pac.nome_completo AS paciente_nome,
  a.profissional_id, pro.nome AS profissional_nome,
  a.servico_id, s.nome AS servico_nome,
  to_char(a.inicio,'YYYY-MM-DD"T"HH24:MI:SSOF') AS inicio,
  to_char(a.fim,'YYYY-MM-DD"T"HH24:MI:SSOF') AS fim,
  to_char(a.inicio AT TIME ZONE ${TZ},'HH24:MI') AS hora_inicio_label,
  to_char(a.fim AT TIME ZONE ${TZ},'HH24:MI') AS hora_fim_label,
  a.status, a.overbooking_intencional,
  to_char(a.identidade_confirmada_em,'YYYY-MM-DD"T"HH24:MI:SS') AS identidade_confirmada_em
`;

/** Agenda de um dia (todos os profissionais), ordenada por horário. */
export async function agendaDoDia(tx: Tx, data: string): Promise<AgendamentoDia[]> {
  const { rows } = await tx.query<AgendamentoDia>(
    `SELECT ${SELECT_AGENDA_DIA}
       FROM agendamentos_sofia_demo a
       LEFT JOIN pacientes pac ON pac.id = a.paciente_id
        AND pac.clinica_id = current_setting('app.clinica_id')::int
       LEFT JOIN profissionais pro ON pro.id = a.profissional_id
       LEFT JOIN servicos s ON s.id = a.servico_id
      WHERE a.clinica_id = current_setting('app.clinica_id')::int
        AND a.inicio IS NOT NULL
        AND (a.inicio AT TIME ZONE ${TZ})::date = $1::date
      ORDER BY a.inicio, pro.nome`,
    [data]
  );
  return rows;
}

/**
 * Cria um agendamento pelo painel. Calcula fim = inicio + duração do serviço e mantém
 * data_agendamento/hora_agendamento (legados) p/ os lembretes n8n. A exclusion constraint
 * `no_overbooking` impede sobreposição — traduzimos o erro 23P01 em mensagem amigável.
 * `overbooking` (encaixe explícito) pula a trava.
 */
export async function criarAgendamento(
  tx: Tx,
  a: {
    pacienteId: number;
    profissionalId: number;
    servicoId: number;
    inicio: string; // ISO datetime (timestamptz)
    overbooking: boolean;
  }
): Promise<number> {
  try {
    // chat_id (nullable): resolve do contato titular do paciente p/ os lembretes n8n
    // chegarem também nos agendamentos de balcão. Sem contato → NULL (sem lembrete auto).
    const { rows } = await tx.query<{ id: number }>(
      `INSERT INTO agendamentos_sofia_demo
         (clinica_id, paciente_id, profissional_id, servico_id, inicio, fim,
          data_agendamento, hora_agendamento, servico, profissional, status,
          overbooking_intencional, chat_id)
       SELECT current_setting('app.clinica_id')::int, $1, $2, $3,
              $4::timestamptz,
              $4::timestamptz + (s.duracao_min || ' min')::interval,
              ($4::timestamptz AT TIME ZONE ${TZ})::date,
              ($4::timestamptz AT TIME ZONE ${TZ})::time,
              s.nome, p.nome, 'confirmada', $5,
              (SELECT cw.chat_id FROM paciente_contato pc
                 JOIN contatos_whatsapp cw ON cw.id = pc.contato_id
                  AND cw.clinica_id = current_setting('app.clinica_id')::int
                WHERE pc.paciente_id = $1
                  AND pc.clinica_id = current_setting('app.clinica_id')::int
                  AND pc.titular = true AND pc.revogado_em IS NULL
                LIMIT 1)
         FROM servicos s, profissionais p
        WHERE s.id = $3 AND s.clinica_id = current_setting('app.clinica_id')::int
          AND p.id = $2 AND p.clinica_id = current_setting('app.clinica_id')::int
       RETURNING id`,
      [a.pacienteId, a.profissionalId, a.servicoId, a.inicio, a.overbooking]
    );
    if (rows.length === 0) throw new Error("Serviço ou profissional inválido nesta clínica.");
    return rows[0].id;
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as { code?: string }).code === "23P01") {
      throw new Error("Horário indisponível: o profissional já tem agendamento que se sobrepõe.");
    }
    throw e;
  }
}

/** Remarca: novo início (recalcula fim e data/hora legados). Mesma trava de overbooking. */
export async function remarcarAgendamento(
  tx: Tx,
  id: number,
  novoInicio: string
): Promise<void> {
  try {
    const res = await tx.query(
      `UPDATE agendamentos_sofia_demo a
          SET inicio = $2::timestamptz,
              fim = $2::timestamptz + (COALESCE(s.duracao_min,30) || ' min')::interval,
              data_agendamento = ($2::timestamptz AT TIME ZONE ${TZ})::date,
              hora_agendamento = ($2::timestamptz AT TIME ZONE ${TZ})::time,
              status = 'confirmada'
         FROM servicos s
        WHERE a.id = $1 AND a.clinica_id = current_setting('app.clinica_id')::int
          AND s.id = a.servico_id`,
      [id, novoInicio]
    );
    if (res.rowCount === 0) throw new Error("Agendamento não encontrado (ou sem serviço vinculado).");
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as { code?: string }).code === "23P01") {
      throw new Error("Horário indisponível: sobreposição com outro agendamento.");
    }
    throw e;
  }
}

/** Muda status (confirmar/realizar/no-show/cancelar). */
export async function mudarStatus(
  tx: Tx,
  id: number,
  status: "confirmada" | "realizada" | "no_show" | "cancelada"
): Promise<void> {
  const res = await tx.query(
    `UPDATE agendamentos_sofia_demo SET status = $2
      WHERE id = $1 AND clinica_id = current_setting('app.clinica_id')::int`,
    [id, status]
  );
  if (res.rowCount === 0) throw new Error("Agendamento não encontrado nesta clínica.");
}

// ===========================================================================
// INDICADORES (D5) — ocupação + no-show
// ===========================================================================

export async function indicadores(
  tx: Tx,
  desde: string,
  ate: string
): Promise<IndicadoresAgenda> {
  // contadores por status no período
  const { rows: c } = await tx.query<{
    agendados: number;
    realizados: number;
    no_show: number;
    minutos_agendados: number;
  }>(
    `SELECT
        count(*) FILTER (WHERE status NOT IN ('cancelada'))::int AS agendados,
        count(*) FILTER (WHERE status = 'realizada')::int        AS realizados,
        count(*) FILTER (WHERE status = 'no_show')::int          AS no_show,
        COALESCE(SUM(EXTRACT(EPOCH FROM (fim - inicio))/60)
                 FILTER (WHERE status NOT IN ('cancelada','no_show')),0)::float8 AS minutos_agendados
       FROM agendamentos_sofia_demo
      WHERE clinica_id = current_setting('app.clinica_id')::int
        AND inicio IS NOT NULL
        AND (inicio AT TIME ZONE ${TZ})::date BETWEEN $1::date AND $2::date`,
    [desde, ate]
  );
  // minutos disponíveis = soma das janelas de turno que caem em cada dia do período
  const { rows: d } = await tx.query<{ minutos_disponiveis: number }>(
    `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (t.hora_fim - t.hora_inicio))/60),0)::float8
              AS minutos_disponiveis
       FROM generate_series($1::date, $2::date, '1 day') dia
       JOIN turnos t
         ON t.clinica_id = current_setting('app.clinica_id')::int
        AND t.ativo
        AND t.dia_semana = extract(dow from dia)::int
        AND t.vigencia_inicio <= dia::date
        AND (t.vigencia_fim IS NULL OR t.vigencia_fim >= dia::date)`,
    [desde, ate]
  );
  const m = c[0];
  const disp = d[0].minutos_disponiveis;
  const fechados = m.realizados + m.no_show;
  return {
    agendados: m.agendados,
    realizados: m.realizados,
    no_show: m.no_show,
    taxa_no_show: fechados > 0 ? m.no_show / fechados : 0,
    ocupacao_pct: disp > 0 ? Math.min(1, m.minutos_agendados / disp) : 0,
  };
}

/**
 * Agenda de um INTERVALO de datas, inclusivo nas duas pontas.
 *
 * Existe porque `agendaDoDia` recebe uma data só, e toda pergunta com escopo de
 * semana obrigava o modelo a chamar a ferramenta cinco vezes — o que estourava
 * o MAX_VOLTAS do chat antes de sobrar orçamento para qualquer outra ferramenta.
 * Achado em produção em 2026-09-05: perguntado "o que vagou essa semana e quem
 * eu chamo para preencher?", o modelo chamou consultar_agenda_do_dia 5x
 * seguidas e desistiu. Ele estava certo; faltava a ferramenta.
 *
 * NÃO filtra status, igual `agendaDoDia`: é justamente a linha `cancelada` que
 * responde "o que vagou". Filtrar aqui esconderia a pergunta.
 *
 * `limite` protege o contexto do modelo — uma janela larga numa clínica cheia
 * devolveria mais linhas do que cabe na conversa.
 */
export async function agendaDoPeriodo(
  tx: Tx,
  de: string,
  ate: string,
  limite = 200
): Promise<AgendamentoDia[]> {
  const { rows } = await tx.query<AgendamentoDia>(
    `SELECT ${SELECT_AGENDA_DIA}
       FROM agendamentos_sofia_demo a
       LEFT JOIN pacientes pac ON pac.id = a.paciente_id
        AND pac.clinica_id = current_setting('app.clinica_id')::int
       LEFT JOIN profissionais pro ON pro.id = a.profissional_id
       LEFT JOIN servicos s ON s.id = a.servico_id
      WHERE a.clinica_id = current_setting('app.clinica_id')::int
        AND a.inicio IS NOT NULL
        AND (a.inicio AT TIME ZONE ${TZ})::date BETWEEN $1::date AND $2::date
      ORDER BY a.inicio, pro.nome
      LIMIT $3`,
    [de, ate, limite]
  );
  return rows;
}

export interface EsperandoVaga {
  id: number;
  paciente_id: number;
  paciente_nome: string | null;
  servico_id: number;
  servico_nome: string | null;
  profissional_id: number | null;
  profissional_nome: string | null;
  /** 'manha' | 'tarde' | 'qualquer' */
  disponibilidade: string;
  expira_em: string | null;
}

/**
 * Quem está esperando vaga. É a outra metade de "o que vagou": sem isto, saber
 * que um horário abriu não diz a ninguém quem chamar.
 *
 * `profissional_id` nulo na lista significa "qualquer profissional serve" — por
 * isso o filtro opcional casa nulo TAMBÉM quando um profissional é informado,
 * senão quem aceita qualquer um sumiria justamente da busca por um específico.
 */
export async function listaDeEspera(
  tx: Tx,
  filtro: { servicoId?: number; profissionalId?: number } = {}
): Promise<EsperandoVaga[]> {
  const { rows } = await tx.query<EsperandoVaga>(
    `SELECT le.id, le.paciente_id, pac.nome_completo AS paciente_nome,
            le.servico_id, s.nome AS servico_nome,
            le.profissional_id, pro.nome AS profissional_nome,
            le.disponibilidade,
            to_char(le.expira_em,'YYYY-MM-DD') AS expira_em
       FROM lista_espera le
       LEFT JOIN pacientes pac ON pac.id = le.paciente_id
        AND pac.clinica_id = current_setting('app.clinica_id')::int
       LEFT JOIN servicos s ON s.id = le.servico_id
       LEFT JOIN profissionais pro ON pro.id = le.profissional_id
      WHERE le.clinica_id = current_setting('app.clinica_id')::int
        AND le.ativo
        AND (le.expira_em IS NULL OR le.expira_em >= current_date)
        AND ($1::int IS NULL OR le.servico_id = $1)
        AND ($2::int IS NULL OR le.profissional_id = $2 OR le.profissional_id IS NULL)
      ORDER BY le.criado_em`,
    [filtro.servicoId ?? null, filtro.profissionalId ?? null]
  );
  return rows;
}
