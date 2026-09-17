"use server";

import { revalidatePath } from "next/cache";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenant } from "@/lib/tenant";
import * as prontuario from "@/server/prontuario.repo";
import * as estoque from "@/server/estoque.repo";
import * as financeiro from "@/server/financeiro.repo";
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
          const r = await estoque.baixarPorAtendimento(tx, {
            tipoAtendimento: tipo,
            agendamentoId,
            entradaId: id,
            usuarioId: session.usuario_id,
          });
          // A1: divergência (estoque insuficiente, C3) não é erro, mas precisa ser
          // observável — senão saldo negativo acumula sem ninguém ver (ver M5).
          if (r.itens_com_divergencia > 0) {
            console.warn(
              `[estoque] baixa com divergência: entrada=${id} tipo=${tipo} ` +
                `clinica=${session.clinica_id} itens_divergencia=${r.itens_com_divergencia}`
            );
          }
        } catch (e) {
          // A1: a baixa NUNCA reverte o atendimento (política C3/C4) — por isso o
          // ROLLBACK TO SAVEPOINT. Mas o erro NÃO pode ser silencioso: sem este log,
          // uma falha sistemática (migração ausente, bug, lock) deixaria o estoque
          // parado sem nenhum sinal. O atendimento finaliza; o estoque fica alertado.
          await tx.query("ROLLBACK TO SAVEPOINT estoque_baixa");
          console.error(
            `[estoque] FALHA na baixa automática (atendimento finalizado mesmo assim): ` +
              `entrada=${id} paciente=${pacienteId} tipo=${tipo} clinica=${session.clinica_id}: ` +
              (e instanceof Error ? e.message : String(e))
          );
        }

        // Cobrança automática (Módulo Financeiro), MESMA política não-bloqueante: um
        // SAVEPOINT próprio isola a cobrança — se faltar preço cadastrado, a tabela não
        // existir, ou qualquer erro, o ROLLBACK TO SAVEPOINT preserva o atendimento. A
        // cobrança nasce 'aberta' com o preço vigente; anti-duplicata por entrada no repo.
        await tx.query("SAVEPOINT financeiro_cobranca");
        try {
          const c = await financeiro.criarCobrancaAutomatica(tx, {
            pacienteId,
            entradaId: id,
            agendamentoId,
            tipoAtendimento: tipo,
            // D5: vencimento D0 (no ato) por padrão. Configurável por clínica em v1.1.
            vencimentoOffsetDias: 0,
          });
          if (!c.criada && c.motivo === "sem_preco") {
            // Não é erro: a clínica ainda não cadastrou o preço deste tipo. Atendimento
            // finaliza; o gestor cadastra o preço e cobra manualmente / relança depois.
            console.warn(
              `[financeiro] sem preço cadastrado p/ tipo=${tipo} clinica=${session.clinica_id}: ` +
                `cobrança não gerada (entrada=${id}).`
            );
          }
        } catch (e) {
          await tx.query("ROLLBACK TO SAVEPOINT financeiro_cobranca");
          console.error(
            `[financeiro] FALHA na cobrança automática (atendimento finalizado mesmo assim): ` +
              `entrada=${id} paciente=${pacienteId} tipo=${tipo} clinica=${session.clinica_id}: ` +
              (e instanceof Error ? e.message : String(e))
          );
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
