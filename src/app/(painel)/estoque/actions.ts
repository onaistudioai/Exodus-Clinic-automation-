"use server";

import { revalidatePath } from "next/cache";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenant } from "@/lib/tenant";
import * as estoque from "@/server/estoque.repo";
import type { TipoAtendimento } from "@/types/domain";

const TIPOS: TipoAtendimento[] = [
  "consulta",
  "retorno",
  "procedimento",
  "avaliacao",
  "limpeza",
];

export interface EstoqueState {
  ok?: boolean;
  erro?: string;
  campo?: string;
}

function num(fd: FormData, k: string): number {
  return Number(String(fd.get(k) ?? "").replace(",", ".").trim());
}

/** Cria produto (gerir_estoque). */
export async function criarProdutoAction(
  _prev: EstoqueState,
  fd: FormData
): Promise<EstoqueState> {
  await requireAcao("gerir_estoque");
  const session = await verifySession();

  const nome = String(fd.get("nome") ?? "").trim();
  const categoria = String(fd.get("categoria") ?? "").trim() || null;
  const unidade = String(fd.get("unidade") ?? "un").trim() || "un";
  const estoqueMinimo = num(fd, "estoque_minimo");
  const controlado = fd.get("controlado") === "on";

  if (nome.length < 2) return { erro: "Informe o nome do produto.", campo: "nome" };
  if (!Number.isFinite(estoqueMinimo) || estoqueMinimo < 0)
    return { erro: "Estoque mínimo inválido.", campo: "estoque_minimo" };

  try {
    await withTenant(session.clinica_id, (tx) =>
      estoque.criarProduto(tx, { nome, categoria, unidade, estoqueMinimo, controlado })
    );
    revalidatePath("/estoque");
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao criar produto." };
  }
}

/** Atualiza produto (gerir_estoque). */
export async function atualizarProdutoAction(
  _prev: EstoqueState,
  fd: FormData
): Promise<EstoqueState> {
  await requireAcao("gerir_estoque");
  const session = await verifySession();

  const id = Number(fd.get("id"));
  const nome = String(fd.get("nome") ?? "").trim();
  const categoria = String(fd.get("categoria") ?? "").trim() || null;
  const unidade = String(fd.get("unidade") ?? "un").trim() || "un";
  const estoqueMinimo = num(fd, "estoque_minimo");
  const controlado = fd.get("controlado") === "on";
  const ativo = fd.get("ativo") !== "nao";

  if (!Number.isInteger(id) || id <= 0) return { erro: "Produto inválido." };
  if (nome.length < 2) return { erro: "Informe o nome do produto.", campo: "nome" };
  if (!Number.isFinite(estoqueMinimo) || estoqueMinimo < 0)
    return { erro: "Estoque mínimo inválido.", campo: "estoque_minimo" };

  try {
    await withTenant(session.clinica_id, (tx) =>
      estoque.atualizarProduto(tx, id, {
        nome,
        categoria,
        unidade,
        estoqueMinimo,
        controlado,
        ativo,
      })
    );
    revalidatePath("/estoque");
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao atualizar produto." };
  }
}

/** Entrada de lote (compra) — gerir_estoque. */
export async function darEntradaAction(
  _prev: EstoqueState,
  fd: FormData
): Promise<EstoqueState> {
  await requireAcao("gerir_estoque");
  const session = await verifySession();

  const produtoId = Number(fd.get("produto_id"));
  const codigoLote = String(fd.get("codigo_lote") ?? "").trim() || null;
  const validade = String(fd.get("validade") ?? "").trim() || null;
  const quantidade = num(fd, "quantidade");
  const custoUnitario = num(fd, "custo_unitario");

  if (!Number.isInteger(produtoId) || produtoId <= 0)
    return { erro: "Selecione o produto.", campo: "produto_id" };
  if (!Number.isFinite(quantidade) || quantidade <= 0)
    return { erro: "Quantidade deve ser maior que zero.", campo: "quantidade" };
  if (!Number.isFinite(custoUnitario) || custoUnitario < 0)
    return { erro: "Custo unitário inválido.", campo: "custo_unitario" };

  try {
    await withTenant(session.clinica_id, (tx) =>
      estoque.darEntrada(tx, {
        produtoId,
        codigoLote,
        validade,
        quantidade,
        custoUnitario,
        usuarioId: session.usuario_id,
      })
    );
    revalidatePath("/estoque");
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao dar entrada." };
  }
}

/** Ajuste de inventário (recontagem) — gerir_estoque. */
export async function ajustarInventarioAction(
  _prev: EstoqueState,
  fd: FormData
): Promise<EstoqueState> {
  await requireAcao("gerir_estoque");
  const session = await verifySession();

  const loteId = Number(fd.get("lote_id"));
  const quantidadeContada = num(fd, "quantidade_contada");
  const observacao = String(fd.get("observacao") ?? "").trim() || undefined;

  if (!Number.isInteger(loteId) || loteId <= 0) return { erro: "Lote inválido." };
  if (!Number.isFinite(quantidadeContada) || quantidadeContada < 0)
    return { erro: "Quantidade contada inválida.", campo: "quantidade_contada" };

  try {
    await withTenant(session.clinica_id, (tx) =>
      estoque.ajustarInventario(tx, {
        loteId,
        quantidadeContada,
        usuarioId: session.usuario_id,
        observacao,
      })
    );
    revalidatePath("/estoque");
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao ajustar inventário." };
  }
}

/** Define item do kit (BOM) — configurar_bom (admin). */
export async function definirBomAction(
  _prev: EstoqueState,
  fd: FormData
): Promise<EstoqueState> {
  await requireAcao("configurar_bom");
  const session = await verifySession();

  const tipoAtendimento = String(fd.get("tipo_atendimento") ?? "") as TipoAtendimento;
  const produtoId = Number(fd.get("produto_id"));
  const quantidade = num(fd, "quantidade");

  if (!TIPOS.includes(tipoAtendimento))
    return { erro: "Selecione o tipo de atendimento.", campo: "tipo_atendimento" };
  if (!Number.isInteger(produtoId) || produtoId <= 0)
    return { erro: "Selecione o produto.", campo: "produto_id" };
  if (!Number.isFinite(quantidade) || quantidade <= 0)
    return { erro: "Quantidade deve ser maior que zero.", campo: "quantidade" };

  try {
    await withTenant(session.clinica_id, (tx) =>
      estoque.definirBomItem(tx, { tipoAtendimento, produtoId, quantidade })
    );
    revalidatePath("/estoque/bom");
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao definir kit." };
  }
}

/** Remove item do kit (BOM) — configurar_bom (admin). */
export async function removerBomAction(
  _prev: EstoqueState,
  fd: FormData
): Promise<EstoqueState> {
  await requireAcao("configurar_bom");
  const session = await verifySession();

  const id = Number(fd.get("id"));
  if (!Number.isInteger(id) || id <= 0) return { erro: "Item inválido." };

  try {
    await withTenant(session.clinica_id, (tx) => estoque.removerBomItem(tx, id));
    revalidatePath("/estoque/bom");
    return { ok: true };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Falha ao remover item." };
  }
}
