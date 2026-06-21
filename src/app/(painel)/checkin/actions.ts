"use server";

import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenantReadOnly } from "@/lib/tenant";
import { hashCpf } from "@/lib/cpf";
import * as pacientes from "@/server/pacientes.repo";
import type { ResultadoBusca } from "@/types/domain";

export interface BuscaState {
  resultados: ResultadoBusca[];
  buscou: boolean; // habilita "criar novo" só DEPOIS de buscar (trava anti-duplicata)
  termo: string;
  erro?: string;
}

const SO_DIGITOS = /^\d{11}$/;

/**
 * Regra-mãe: BUSCAR antes de CRIAR. Única action que marca `buscou=true`.
 * Action = autoriza + valida + abre tenant; Repo = SQL.
 */
export async function buscarPacientes(
  _prev: BuscaState,
  formData: FormData
): Promise<BuscaState> {
  await requireAcao("checkin");
  const session = await verifySession();

  const bruto = String(formData.get("termo") ?? "").trim();
  const soDigitos = bruto.replace(/\D/g, "");

  if (bruto.length < 3 && !SO_DIGITOS.test(soDigitos)) {
    return {
      resultados: [],
      buscou: false,
      termo: bruto,
      erro: "Digite ao menos 3 letras ou um CPF (11 dígitos).",
    };
  }

  try {
    const resultados = await withTenantReadOnly(session.clinica_id, async (tx) => {
      if (SO_DIGITOS.test(soDigitos)) {
        const { cpfHash } = hashCpf(soDigitos); // Caminho A
        return pacientes.buscarPorCpf(tx, cpfHash);
      }
      return pacientes.buscarPorNome(tx, bruto); // Caminho B
    });
    return { resultados, buscou: true, termo: bruto };
  } catch (e) {
    return {
      resultados: [],
      buscou: false,
      termo: bruto,
      erro: e instanceof Error ? e.message : "Falha na busca.",
    };
  }
}
