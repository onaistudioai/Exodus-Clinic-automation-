"use server";

import { revalidatePath } from "next/cache";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenant } from "@/lib/tenant";
import * as prontuario from "@/server/prontuario.repo";
import * as estoque from "@/server/estoque.repo";
import { RETORNO_DIAS, type TipoAtendimento } from "@/types/domain";

const TIPOS: TipoAtendimento[] = [
  "consulta",
  "retorno",
  "procedimento",
  "avaliacao",
  "limpeza",
];

export interface AtendimentoState {
  ok?: boolean;
  entradaId?: number;
  erro?: string;
  campo?: string;
}

/**
 * Registra um atendimento finalizado (DRAFT §prontuário). Cria a entrada (rascunho ou
 * correção de uma finalizada) e FINALIZA na mesma transação — o trigger marca o
 * agendamento vinculado como 'realizada'. Append-only: corrigir nunca edita a original,
 * cria nova com `corrige_entrada_id`. Toda escrita clínica é auditada (prontuario_acessos).
 * RBAC: `criar_entrada_prontuario` = só médico.
 */
export async function registrarAtendimento(
  _prev: AtendimentoState,
  formData: FormData
): Promise<AtendimentoState> {
  await requireAcao("criar_entrada_prontuario");
  const session = await verifySession();

  const pacienteId = Number(formData.get("pacienteId"));
  const agRaw = String(formData.get("agendamentoId") ?? "").trim();
  const agendamentoId = agRaw ? Number(agRaw) : null;
  const corrigeRaw = String(formData.get("corrigeEntradaId") ?? "").trim();
  const corrigeEntradaId = corrigeRaw ? Number(corrigeRaw) : null;

  const texto = String(formData.get("texto_clinico") ?? "").trim();
  const tipo = String(formData.get("tipo_atendimento") ?? "") as TipoAtendimento;
  const precisaRetorno = formData.get("precisa_retorno") === "sim";
  const retornoRaw = String(formData.get("retorno_em_dias") ?? "").trim();
  const retornoEmDias = precisaRetorno && retornoRaw ? Number(retornoRaw) : null;
  const orientacoes = String(formData.get("orientacoes_paciente") ?? "").trim() || null;

  if (!Number.isInteger(pacienteId) || pacienteId <= 0) return { erro: "Paciente inválido." };
  if (texto.length < 3)
    return { erro: "Escreva o texto clínico do atendimento.", campo: "texto_clinico" };
  if (!TIPOS.includes(tipo))
    return { erro: "Selecione o tipo de atendimento.", campo: "tipo_atendimento" };
  if (precisaRetorno && !(RETORNO_DIAS as readonly number[]).includes(retornoEmDias ?? -1))
    return { erro: "Selecione em quantos dias é o retorno.", campo: "retorno_em_dias" };

  try {
    const entradaId = await withTenant(session.clinica_id, async (tx) => {
      const id = corrigeEntradaId
        ? await prontuario.corrigir(tx, {
            pacienteId,
            agendamentoId,
            profissionalId: session.usuario_id,
            corrigeEntradaId,
          })
        : await prontuario.criarRascunho(tx, {
            pacienteId,
            agendamentoId,
            profissionalId: session.usuario_id,
          });

      await prontuario.finalizar(tx, {
        id,
        textoClinico: texto,
        tipoAtendimento: tipo,
        precisaRetorno,
        retornoEmDias,
        orientacoesPaciente: orientacoes,
      });

      await prontuario.registrarAcesso(
        tx,
        corrigeEntradaId ? "corrigiu" : "criou",
        session.usuario_id,
        pacienteId,
        id,
        corrigeEntradaId ? `corrige #${corrigeEntradaId}` : undefined
      );
      await prontuario.registrarAcesso(tx, "finalizou", session.usuario_id, pacienteId, id);

      // Baixa automática de estoque do kit do procedimento (Módulo Estoque).
      // POLÍTICA C3/C4: nunca pode reverter o atendimento. Um SAVEPOINT isola a baixa
      // — se ela falhar por QUALQUER motivo (estoque insuficiente já é tratado dentro
      // do repo sem lançar; mas tabelas ausentes, erro inesperado, etc. caem aqui), o
      // ROLLBACK TO SAVEPOINT preserva a transação e o atendimento é finalizado normal.
      // Só roda em entrada NOVA: correção é conserto de texto, não re-consome material.
      if (!corrigeEntradaId) {
        await tx.query("SAVEPOINT estoque_baixa");
        try {
          await estoque.baixarPorAtendimento(tx, {
            tipoAtendimento: tipo,
            agendamentoId,
            entradaId: id,
            usuarioId: session.usuario_id,
          });
        } catch {
          await tx.query("ROLLBACK TO SAVEPOINT estoque_baixa");
        }
      }
      return id;
    });

    revalidatePath(`/prontuario/${pacienteId}`);
    return { ok: true, entradaId };
  } catch (e) {
    // chk_finalizado_exige_tags etc. caem aqui se a validação acima deixar passar algo.
    return { erro: e instanceof Error ? e.message : "Falha ao registrar atendimento." };
  }
}
