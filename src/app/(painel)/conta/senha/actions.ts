"use server";

import bcrypt from "bcryptjs";
import { verifySession } from "@/lib/dal";
import { withTenant } from "@/lib/tenant";
import { hashSenha } from "@/lib/auth";
import * as usuarios from "@/server/usuarios.repo";

export interface SenhaState {
  ok?: boolean;
  erro?: string;
  campo?: string;
}

const SENHA_MINIMA = 10;

/**
 * Troca a PRÓPRIA senha. Sem `requireAcao`: não existe ação para isto, e não
 * deve existir — todo mundo com login troca a própria senha, inclusive quem
 * não tem permissão para mais nada. É justamente o que impede o admin da
 * clínica de conhecer a senha da equipe para sempre.
 *
 * O id vem SEMPRE da sessão, nunca do formulário. Se viesse do formulário isto
 * seria "trocar a senha de qualquer um", e nenhuma validação depois consertaria.
 *
 * A trava de fundo é a acesso-017: a policy de UPDATE deixa cada um tocar a
 * própria linha, e o trigger `trg_usuarios_guarda_papel` impede que essa mesma
 * abertura vire troca de papel. Não confie só neste arquivo.
 */
export async function trocarSenhaAction(
  _prev: SenhaState,
  formData: FormData
): Promise<SenhaState> {
  const session = await verifySession();

  const atual = String(formData.get("atual") ?? "");
  const nova = String(formData.get("nova") ?? "");
  const nova2 = String(formData.get("nova2") ?? "");

  if (!atual) return { erro: "Informe a senha atual.", campo: "atual" };
  if (nova.length < SENHA_MINIMA)
    return { erro: `A nova senha precisa de ao menos ${SENHA_MINIMA} caracteres.`, campo: "nova" };
  if (nova !== nova2) return { erro: "As duas senhas não conferem.", campo: "nova2" };
  if (nova === atual)
    return { erro: "A nova senha tem de ser diferente da atual.", campo: "nova" };

  return withTenant(session.clinica_id, async (tx) => {
    const hashAtual = await usuarios.hashDe(tx, session.usuario_id);
    // Sem hash é conta provisionada por caminho antigo (só nome/papel, sem
    // credencial). Não dá para conferir a senha atual, então não dá para
    // trocar por aqui — o caminho é o admin recriar o acesso.
    if (!hashAtual)
      return { erro: "Esta conta não tem senha definida. Peça ao admin da clínica." };

    if (!(await bcrypt.compare(atual, hashAtual)))
      return { erro: "Senha atual incorreta.", campo: "atual" };

    const ok = await usuarios.trocarSenha(tx, session.usuario_id, await hashSenha(nova));
    if (!ok) return { erro: "Não foi possível trocar a senha." };

    // ponytail: sem invalidar as outras sessões. O cookie é JWT de 8h e não há
    // lista de sessões para revogar — trocar a senha não derruba um cookie já
    // emitido. Adicionar quando existir uma tabela de sessões.
    return { ok: true };
  });
}
