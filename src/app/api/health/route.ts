import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

// L3: healthcheck que valida dependências (Postgres) em vez de só responder 200.
// O pool é LAZY (db.ts), então sem DATABASE_URL o app sobe e /login renderiza;
// este endpoint é o ponto onde a falta/queda do banco vira sinal explícito (503)
// p/ o healthcheck da plataforma / monitor externo, em vez de degradar em silêncio.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await pool.query("SELECT 1");
    return NextResponse.json({ status: "ok", db: "up" });
  } catch (err) {
    console.error("[health] dependência indisponível:", err);
    return NextResponse.json(
      { status: "degraded", db: "down" },
      { status: 503 }
    );
  }
}
