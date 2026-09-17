"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { buscarPacienteProntuario } from "./actions";
import type { ResultadoBusca } from "@/types/domain";

export default function BuscaProntuario() {
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<ResultadoBusca[]>([]);
  const [buscou, setBuscou] = useState(false);
  const [pending, start] = useTransition();

  function buscar() {
    if (termo.trim().length < 3) return;
    start(async () => {
      setResultados(await buscarPacienteProntuario(termo));
      setBuscou(true);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              buscar();
            }
          }}
          placeholder="buscar paciente por nome"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
        />
        <button
          type="button"
          onClick={buscar}
          disabled={pending || termo.trim().length < 3}
          className="rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {pending ? "Buscando…" : "🔍 Buscar"}
        </button>
      </div>

      {buscou && resultados.length === 0 && (
        <p className="text-sm text-neutral-500">Nenhum paciente encontrado.</p>
      )}
      {resultados.length > 0 && (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-white ring-1 ring-black/5">
          {resultados.map((r) => (
            <li key={r.id} className="flex items-center justify-between p-4">
              <div>
                <div className="font-medium">
                  {r.nome_completo}{" "}
                  <span className="text-sm font-normal text-neutral-500">{r.idade} anos</span>
                </div>
                <div className="text-sm text-neutral-500">
                  {r.cpf_last4 ? `CPF …-${r.cpf_last4}` : "(sem CPF)"} · último atend.:{" "}
                  {r.ultimo_atendimento ?? "nunca"}
                </div>
              </div>
              <Link
                href={`/prontuario/${r.id}`}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:border-neutral-900"
              >
                Abrir prontuário
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
