"use server";

import { revalidatePath } from "next/cache";
import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenant } from "@/lib/tenant";
import { hashSenha } from "@/lib/auth";
import * as usuarios from "@/server/usuarios.repo";

export interface EquipeState {
  ok?: boolean;
  erro?: string;
  campo?: string;
}

/** Erro do Postgres com `code`, sem `any`. */
function codigoPg(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e
    ? String((e as { code: unknown }).code)
    : undefined;
}

const SENHA_MINIMA = 10;

/**
 * Cria um usuário da própria clínica.
 *
 * Duas camadas de autorização, de propósito: `requireAcao` dá a mensagem de
 * erro boa, e a policy RESTRICTIVE `rls_papel_gerir_usuarios_ins` (acesso-016)
 * é quem nega de verdade. Se alguém remover a linha do `requireAcao` por
 * engano, isto continua barrado no banco — que é o ponto de ter as duas.
 *
 * `clinica_id` nunca vem do formulário: sai do GUC dentro do repo, e o GUC sai
 * da sessão dentro de `withTenant`.
 */
export async function criarUsuarioAction(
  _prev: EquipeState,
  formData: FormData
): Promise<EquipeState> {
  await requireAcao("gerir_usuarios");
  const session = await verifySession();

  const nome = String(formData.get("nome") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const papel = String(formData.get("papel") ?? "").trim();
  const senha = String(formData.get("senha") ?? "");
  const senha2 = String(formData.get("senha2") ?? "");

  if (nome.length < 3) return { erro: "Informe o nome completo.", campo: "nome" };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return { erro: "E-mail inválido.", campo: "email" };
  if (!papel) return { erro: "Escolha o papel.", campo: "papel" };
  if (senha.length < SENHA_MINIMA)
    return { erro: `A senha precisa de ao menos ${SENHA_MINIMA} caracteres.`, campo: "senha" };
  if (senha !== senha2)
    return { erro: "As duas senhas não conferem.", campo: "senha2" };

  const senhaHash = await hashSenha(senha);

  try {
    await withTenant(session.clinica_id, (tx) =>
      usuarios.criar(tx, { nome, email, senhaHash, papel })
    );
  } catch (e) {
    const code = codigoPg(e);
    // 23505 = unique_violation (uq_usuarios_email_por_clinica). Mesmo
    // tratamento que checkin/criar-actions.ts dá ao CPF duplicado.
    if (code === "23505")
      return { erro: "Já existe alguém com este e-mail nesta clínica.", campo: "email" };
    // 23503 = foreign_key_violation: papel que não existe em `papel.chave`
    // (a FK criada pela acesso-016). Só chega aqui com formulário adulterado.
    if (code === "23503") return { erro: "Papel inválido.", campo: "papel" };
    // 42501 = insufficient_privilege / negação por RLS. Não vaza detalhe.
    if (code === "42501") return { erro: "Você não tem permissão para isso." };
    throw e;
  }

  revalidatePath("/admin/usuarios");
  return { ok: true };
}

/**
 * Ativa ou desativa alguém da equipe. Nunca deleta — `app_painel` não tem
 * DELETE em lugar nenhum do schema, e `fn_login_lookup` já filtra `ativo`,
 * então desativar corta o login no mesmo instante.
 */
export async function definirAtivoAction(
  _prev: EquipeState,
  formData: FormData
): Promise<EquipeState> {
  await requireAcao("gerir_usuarios");
  const session = await verifySession();

  const id = Number(formData.get("id"));
  const ativo = String(formData.get("ativo")) === "sim";
  if (!Number.isInteger(id) || id <= 0) return { erro: "Usuário inválido." };

  // Desativar a si mesmo tranca a pessoa para fora na hora seguinte, e se for
  // o único admin da clínica tranca TODO MUNDO para fora de /admin/usuarios —
  // sem caminho de volta pela aplicação (só pelo script de provisionamento).
  if (id === session.usuario_id && !ativo)
    return { erro: "Você não pode desativar a própria conta." };

  try {
    await withTenant(session.clinica_id, (tx) => usuarios.definirAtivo(tx, id, ativo));
  } catch (e) {
    if (codigoPg(e) === "42501") return { erro: "Você não tem permissão para isso." };
    throw e;
  }

  revalidatePath("/admin/usuarios");
  return { ok: true };
}
