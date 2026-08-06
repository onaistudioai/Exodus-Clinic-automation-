"use server";

import { redirect } from "next/navigation";
import { autenticar } from "@/lib/auth";
import { createSessionCookie } from "@/lib/session";
import { registrarTentativaLogin } from "@/lib/rate-limit";

export interface LoginState {
  erro?: string;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const senha = String(formData.get("senha") ?? "");
  const next = String(formData.get("next") ?? "/") || "/";

  if (!email || !senha) {
    return { erro: "Informe e-mail e senha." };
  }

  // S5 — freio ANTES de validar a senha: sem isso, o bcrypt (cost 12) vira o
  // gargalo e um spray de tentativas derruba o painel além de tentar adivinhar.
  const preCheck = await registrarTentativaLogin(email, false);
  if (preCheck.bloqueado) {
    return {
      erro: `Muitas tentativas. Tente novamente em ${Math.ceil(preCheck.segundos / 60)} min.`,
    };
  }

  const session = await autenticar(email, senha);
  if (!session) {
    // Mensagem genérica: não revela se o e-mail existe.
    return { erro: "E-mail ou senha inválidos." };
  }

  // Sucesso zera o histórico da chave (email, ip).
  await registrarTentativaLogin(email, true);

  await createSessionCookie(session);
  redirect(next.startsWith("/") ? next : "/");
}
