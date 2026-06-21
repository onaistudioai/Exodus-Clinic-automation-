"use server";

import { redirect } from "next/navigation";
import { autenticar } from "@/lib/auth";
import { createSessionCookie } from "@/lib/session";

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

  const session = await autenticar(email, senha);
  if (!session) {
    // Mensagem genérica: não revela se o e-mail existe.
    return { erro: "E-mail ou senha inválidos." };
  }

  await createSessionCookie(session);
  redirect(next.startsWith("/") ? next : "/");
}
