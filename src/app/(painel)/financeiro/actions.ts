"use server";

import { revalidatePath } from "next/cache";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenant } from "@/lib/tenant";
import * as financeiro from "@/server/financeiro.repo";
import {
  type TipoAtendimento,
  type FormaPagamento,
  type TipoLancamento,
} from "@/types/domain";

const TIPOS: TipoAtendimento[] = [
  "consulta",
  "retorno",
  "procedimento",
  "avaliacao",
  "limpeza",
];
const FORMAS: FormaPagamento[] = ["pix", "cartao", "dinheiro", "outro"];

export interface FinanceiroState {
  ok?: boolean;
  erro?: string;
  campo?: string;
}

function num(fd: FormData, k: string): number {
  return Number(String(fd.get(k) ?? "").replace(",", ".").trim());
}

/** Define/atualiza o preço de um tipo de atendimento (gerir_financeiro). */
export async function definirPrecoAction(
  _prev: FinanceiroState,
  fd: FormData
): Promise<FinanceiroState> {
  await requireAcao("gerir_financeiro");
  const session = await verifySession();

  const tipoAtendimento = String(fd.get("tipo_atendimento") ?? "") as TipoAtendimento;
  const valor = num(fd, "valor");
  const ativo = fd.get("ativo") === "sim";

  if (!TIPOS.includes(tipoAtendimento))
    return { erro: "Selecione o tipo de atendimento.", campo: "tipo_atendimento" };
  if (!Number.isFinite(valor) || valor < 0)
    return { erro: "Valor inválido.", campo: "valor" };

  try {
    await withTenant(session.clinica_id, (tx) =>
      financeiro.definirPreco(tx, { tipoAtendimento, valor, ativo })
    );
    revalidatePath("/financeiro/precos");
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao definir preço." };
  }
}

/** Registra pagamento de uma cobrança (gerir_financeiro). Idempotente no repo. */
export async function registrarPagamentoAction(
  _prev: FinanceiroState,
  fd: FormData
): Promise<FinanceiroState> {
  await requireAcao("gerir_financeiro");
  const session = await verifySession();

  const cobrancaId = Number(fd.get("cobranca_id"));
  const formaPagamento = String(fd.get("forma_pagamento") ?? "") as FormaPagamento;

  if (!Number.isInteger(cobrancaId) || cobrancaId <= 0)
    return { erro: "Cobrança inválida." };
  if (!FORMAS.includes(formaPagamento))
    return { erro: "Selecione a forma de pagamento.", campo: "forma_pagamento" };

  try {
    const r = await withTenant(session.clinica_id, (tx) =>
      financeiro.registrarPagamento(tx, {
        cobrancaId,
        formaPagamento,
        usuarioId: session.usuario_id,
      })
    );
    revalidatePath("/financeiro");
    if (r.ja_pago) return { ok: true, erro: "Cobrança já estava paga." };
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao registrar pagamento." };
  }
}

/** Lançamento manual de caixa — receita ou despesa avulsa (gerir_financeiro). */
export async function lancamentoManualAction(
  _prev: FinanceiroState,
  fd: FormData
): Promise<FinanceiroState> {
  await requireAcao("gerir_financeiro");
  const session = await verifySession();

  const tipo = String(fd.get("tipo") ?? "") as TipoLancamento;
  const valor = num(fd, "valor");
  const categoria = String(fd.get("categoria") ?? "").trim() || null;
  const descricao = String(fd.get("descricao") ?? "").trim() || null;
  const formaRaw = String(fd.get("forma_pagamento") ?? "").trim();
  const formaPagamento = (FORMAS as string[]).includes(formaRaw)
    ? (formaRaw as FormaPagamento)
    : null;

  if (tipo !== "receita" && tipo !== "despesa")
    return { erro: "Selecione receita ou despesa.", campo: "tipo" };
  if (!Number.isFinite(valor) || valor <= 0)
    return { erro: "Valor deve ser maior que zero.", campo: "valor" };

  try {
    await withTenant(session.clinica_id, (tx) =>
      financeiro.lancamentoManual(tx, {
        tipo,
        valor,
        categoria,
        descricao,
        formaPagamento,
        usuarioId: session.usuario_id,
      })
    );
    revalidatePath("/financeiro");
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao lançar." };
  }
}

/** Cancela uma cobrança aberta com motivo (gerir_financeiro). */
export async function cancelarCobrancaAction(
  _prev: FinanceiroState,
  fd: FormData
): Promise<FinanceiroState> {
  await requireAcao("gerir_financeiro");
  const session = await verifySession();

  const cobrancaId = Number(fd.get("cobranca_id"));
  const motivo = String(fd.get("motivo") ?? "").trim();

  if (!Number.isInteger(cobrancaId) || cobrancaId <= 0)
    return { erro: "Cobrança inválida." };
  if (motivo.length < 3)
    return { erro: "Informe o motivo do cancelamento.", campo: "motivo" };

  try {
    await withTenant(session.clinica_id, (tx) =>
      financeiro.cancelarCobranca(tx, cobrancaId, motivo)
    );
    revalidatePath("/financeiro");
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao cancelar cobrança." };
  }
}
