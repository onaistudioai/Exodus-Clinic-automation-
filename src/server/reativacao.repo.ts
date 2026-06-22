import "server-only";
import type { Tx } from "@/lib/db";
import type {
  Campanha,
  PassoCampanha,
  InativoElegivel,
  AlvoReativacao,
  EnvioReativacao,
  MetricasReativacao,
  ResultadoMaterializacao,
} from "@/types/domain";

/**
 * DAL — Reativação (Módulo Reativação, OPUS). Todas as tabelas têm RLS FORCE por
 * clinica_id; o GUC `app.clinica_id` é setado por withTenant() — aqui só se usa o
 * current_setting. `reativacao_envios` é append-only (trigger). A camada de Action
 * aplica o RBAC (requireAcao) antes de chamar isto.
 *
 * Decisões (config.json): janela default 30d; passos D+0/D+7/D+21; opt-out v1 só
 * honra paciente_contato.revogado_em; envio dry-run default (envio real é do worker n8n).
 */

const SELECT_CAMPANHA = `
  id, clinica_id, nome, janela_dias, passos, ativa,
  to_char(criado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em,
  to_char(atualizado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS atualizado_em
`;

// ===========================================================================
// CAMPANHAS
// ===========================================================================

export async function listarCampanhas(tx: Tx): Promise<Campanha[]> {
  const { rows } = await tx.query<Campanha>(
    `SELECT ${SELECT_CAMPANHA} FROM reativacao_campanhas
      WHERE clinica_id = current_setting('app.clinica_id')::int
      ORDER BY ativa DESC, criado_em DESC`
  );
  return rows;
}

export async function getCampanhaAtiva(tx: Tx): Promise<Campanha | null> {
  const { rows } = await tx.query<Campanha>(
    `SELECT ${SELECT_CAMPANHA} FROM reativacao_campanhas
      WHERE clinica_id = current_setting('app.clinica_id')::int AND ativa = true
      LIMIT 1`
  );
  return rows[0] ?? null;
}

export interface NovaCampanha {
  nome: string;
  janelaDias: number;
  passos: PassoCampanha[];
}

export async function criarCampanha(tx: Tx, c: NovaCampanha): Promise<number> {
  const { rows } = await tx.query<{ id: number }>(
    `INSERT INTO reativacao_campanhas (clinica_id, nome, janela_dias, passos)
     VALUES (current_setting('app.clinica_id')::int, $1, $2, $3::jsonb)
     RETURNING id`,
    [c.nome, c.janelaDias, JSON.stringify(c.passos)]
  );
  return rows[0].id;
}

/**
 * Liga/desliga uma campanha. Ao LIGAR, desliga as demais da clínica primeiro
 * (o índice único parcial uq_campanha_ativa_por_clinica só admite 1 ativa).
 */
export async function definirCampanhaAtiva(
  tx: Tx,
  campanhaId: number,
  ativa: boolean
): Promise<void> {
  if (ativa) {
    await tx.query(
      `UPDATE reativacao_campanhas SET ativa = false, atualizado_em = NOW()
        WHERE clinica_id = current_setting('app.clinica_id')::int
          AND ativa = true AND id <> $1`,
      [campanhaId]
    );
  }
  const res = await tx.query(
    `UPDATE reativacao_campanhas SET ativa = $2, atualizado_em = NOW()
      WHERE id = $1 AND clinica_id = current_setting('app.clinica_id')::int`,
    [campanhaId, ativa]
  );
  if (res.rowCount === 0) throw new Error("Campanha não encontrada nesta clínica.");
}

// ===========================================================================
// INATIVOS (view) + MATERIALIZAÇÃO DE ALVOS
// ===========================================================================

/** Pacientes elegíveis que passam na janela da campanha (ordenado por mais inativo). */
export async function listarInativos(
  tx: Tx,
  janelaDias: number,
  limite = 500
): Promise<InativoElegivel[]> {
  const { rows } = await tx.query<InativoElegivel>(
    `SELECT paciente_id, nome_completo,
            to_char(ultimo_atendimento,'YYYY-MM-DD') AS ultimo_atendimento,
            dias_inativo, contato_id, chat_id, telefone
       FROM v_reativacao_inativos
      WHERE dias_inativo >= $1
      ORDER BY dias_inativo DESC
      LIMIT $2`,
    [janelaDias, limite]
  );
  return rows;
}

/** Preview: quantos pacientes entrariam na sequência (sem efeito colateral). */
export async function contarInativos(tx: Tx, janelaDias: number): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM v_reativacao_inativos WHERE dias_inativo >= $1`,
    [janelaDias]
  );
  return rows[0].n;
}

/**
 * Materializa os inativos elegíveis como alvos da campanha (entram na sequência).
 * passo_atual=0, proximo_envio = NOW() + offset do 1º passo (D+0 => agora).
 * Anti-duplicata: ON CONFLICT no índice parcial uq_alvo_ativo_por_paciente (já em
 * sequência) NÃO insere. WITH CHECK da RLS garante clinica_id = GUC (anti cross-tenant).
 */
export async function materializarAlvos(
  tx: Tx,
  campanhaId: number,
  janelaDias: number,
  primeiroOffsetDias: number,
  limite = 500
): Promise<ResultadoMaterializacao> {
  const elegiveis = await contarInativos(tx, janelaDias);
  const { rows } = await tx.query<{ id: number }>(
    `INSERT INTO reativacao_alvos
        (clinica_id, campanha_id, paciente_id, contato_id, passo_atual, proximo_envio, status)
     SELECT current_setting('app.clinica_id')::int, $1, v.paciente_id, v.contato_id,
            0, NOW() + ($3 || ' days')::interval, 'ativo'
       FROM v_reativacao_inativos v
      WHERE v.dias_inativo >= $2
      ORDER BY v.dias_inativo DESC
      LIMIT $4
     ON CONFLICT (clinica_id, paciente_id) WHERE status = 'ativo'
     DO NOTHING
     RETURNING id`,
    [campanhaId, janelaDias, primeiroOffsetDias, limite]
  );
  const inseridos = rows.length;
  return { inseridos, ignorados: Math.max(0, elegiveis - inseridos) };
}

// ===========================================================================
// ALVOS + ENVIOS (envios reais são do worker n8n; aqui é leitura/atribuição)
// ===========================================================================

export async function listarAlvos(
  tx: Tx,
  status?: AlvoReativacao["status"]
): Promise<AlvoReativacao[]> {
  const { rows } = await tx.query<AlvoReativacao>(
    `SELECT id, clinica_id, campanha_id, paciente_id, contato_id, passo_atual,
            to_char(proximo_envio,'YYYY-MM-DD"T"HH24:MI:SS') AS proximo_envio, status,
            to_char(entrou_em,'YYYY-MM-DD"T"HH24:MI:SS') AS entrou_em,
            to_char(reativado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS reativado_em,
            to_char(atualizado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS atualizado_em
       FROM reativacao_alvos
      WHERE clinica_id = current_setting('app.clinica_id')::int
        AND ($1::text IS NULL OR status = $1)
      ORDER BY proximo_envio`,
    [status ?? null]
  );
  return rows;
}

export async function listarEnvios(tx: Tx, alvoId: number): Promise<EnvioReativacao[]> {
  const { rows } = await tx.query<EnvioReativacao>(
    `SELECT id, clinica_id, alvo_id, passo, modo, wa_status, wa_erro,
            to_char(enviado_em,'YYYY-MM-DD"T"HH24:MI:SS') AS enviado_em
       FROM reativacao_envios
      WHERE clinica_id = current_setting('app.clinica_id')::int AND alvo_id = $1
      ORDER BY enviado_em DESC`,
    [alvoId]
  );
  return rows;
}

/**
 * Atribuição de retorno: marca como 'reativado' os alvos ativos cujo paciente criou
 * um agendamento novo (pendente|confirmada) DEPOIS de entrar na sequência, dentro da
 * janela de atribuição. agendamentos_sofia_demo não tem RLS -> filtra clinica_id explícito.
 * Retorna quantos foram reativados.
 */
export async function rodarAtribuicao(
  tx: Tx,
  janelaAtribuicaoDias = 30
): Promise<number> {
  const res = await tx.query(
    `UPDATE reativacao_alvos ra
        SET status = 'reativado', reativado_em = NOW(), atualizado_em = NOW()
      WHERE ra.clinica_id = current_setting('app.clinica_id')::int
        AND ra.status = 'ativo'
        AND EXISTS (
          SELECT 1 FROM agendamentos_sofia_demo a
           WHERE a.paciente_id = ra.paciente_id
             AND a.clinica_id = ra.clinica_id
             AND a.status IN ('pendente','confirmada')
             AND a.criado_em > ra.entrou_em
             AND a.criado_em <= ra.entrou_em + ($1 || ' days')::interval
        )`,
    [janelaAtribuicaoDias]
  );
  return res.rowCount ?? 0;
}

/** Marca opt-out manual (encerra a sequência ativa do paciente). v1.1: gatilho via SOFIA. */
export async function marcarOptout(tx: Tx, pacienteId: number): Promise<void> {
  await tx.query(
    `UPDATE reativacao_alvos
        SET status = 'optout', atualizado_em = NOW()
      WHERE clinica_id = current_setting('app.clinica_id')::int
        AND paciente_id = $1 AND status = 'ativo'`,
    [pacienteId]
  );
}

// ===========================================================================
// MÉTRICAS (painel)
// ===========================================================================

export async function metricas(tx: Tx, janelaDias: number): Promise<MetricasReativacao> {
  const { rows } = await tx.query<{
    em_sequencia: number;
    reativados: number;
    optout: number;
    concluido: number;
    enviados: number;
  }>(
    `SELECT
        count(*) FILTER (WHERE status = 'ativo')::int      AS em_sequencia,
        count(*) FILTER (WHERE status = 'reativado')::int  AS reativados,
        count(*) FILTER (WHERE status = 'optout')::int     AS optout,
        count(*) FILTER (WHERE status = 'concluido')::int  AS concluido,
        (SELECT count(DISTINCT (alvo_id, passo))::int
           FROM reativacao_envios
          WHERE clinica_id = current_setting('app.clinica_id')::int AND modo = 'live') AS enviados
       FROM reativacao_alvos
      WHERE clinica_id = current_setting('app.clinica_id')::int`
  );
  const m = rows[0];
  const elegiveis = await contarInativos(tx, janelaDias);
  const denom = m.reativados + m.em_sequencia + m.concluido;
  return {
    elegiveis,
    em_sequencia: m.em_sequencia,
    enviados: m.enviados,
    reativados: m.reativados,
    optout: m.optout,
    taxa_reativacao: denom > 0 ? m.reativados / denom : 0,
  };
}
