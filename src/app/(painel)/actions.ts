"use server";

import { redirect } from "next/navigation";
import { clearSessionCookie } from "@/lib/session";

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}
