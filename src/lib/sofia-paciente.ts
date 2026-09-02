import "server-only";
import { NextResponse } from "next/server";
import type { Tx } from "@/lib/db";
import { normalizarTelefone } from "@/lib/telefone";
import {
  resolverPacientePorTelefone,
  confirmarIdentidade,
  type PacienteIdentificado,
} from "@/server/identidade.repo";
import { freioIdentidadePg, type FreioIdentidade } from "@/server/freio-identidade.repo";

/**
 * Passo de identidade compartilhado pelas rotas /api/sofia/* que tocam dado de
 * paciente. Extraído para que nenhuma rota nova possa "esquecer" de exigir a
 * confirmação — é mais fácil chamar isto do que reimplementar errado.
 *
 * Devolve NextResponse quando a identidade não fecha; a rota repassa direto.
 */
export type ResultadoIdentidade =
  | { ok: true; paciente: PacienteIdentificado }
  | { ok: false; resposta: NextResponse };

interface CorpoComIdentidade {
  telefone?: unknown;
  data_nascimento?: unknown;
}

export async function identificarPaciente(
  tx: Tx,
  corpo: CorpoComIdentidade,
  freio: FreioIdentidade = freioIdentidadePg
): Promise<ResultadoIdentidade> {
  if (typeof corpo.telefone !== "string") {
    return {
      ok: false,
      resposta: NextResponse.json({ erro: "telefone_obrigatorio" }, { status: 400 }),
    };
  }

  const telefone = normalizarTelefone(corpo.telefone);
  if (!telefone) {
    return {
      ok: false,
      resposta: NextResponse.json({ erro: "telefone_invalido" }, { status: 400 }),
    };
  }

  const paciente = await resolverPacientePorTelefone(tx, telefone);

  // Mesma resposta para "não cadastrado" e "ambíguo": não confirmamos a
  // existência de cadastro para quem ainda não provou identidade.
  if (!paciente) {
    return {
      ok: false,
      resposta: NextResponse.json({ identificado: false, confirmado: false }),
    };
  }

  if (typeof corpo.data_nascimento !== "string") {
    // Fluxo normal, sem data ainda — não consulta nem conta o freio: senão o
    // paciente legítimo se autobloqueia só de conversar.
    return {
      ok: false,
      resposta: NextResponse.json({
        identificado: true,
        confirmado: false,
        motivo: "confirme_data_nascimento",
        primeiro_nome: paciente.nome.split(" ")[0],
      }),
    };
  }

  // Consulta em modo leitura, sem registrar: uma data foi enviada, então é
  // aqui que o freio precisa valer — mas checar o estado atual não é, por si
  // só, uma tentativa.
  const espera = await freio.consultar(telefone);
  if (espera > 0) {
    return {
      ok: false,
      resposta: NextResponse.json({
        identificado: true,
        confirmado: false,
        motivo: "muitas_tentativas",
        espera_segundos: espera,
      }),
    };
  }

  const confere = await confirmarIdentidade(tx, paciente.pacienteId, corpo.data_nascimento);
  if (!confere) {
    await freio.registrar(telefone, false);
    return {
      ok: false,
      resposta: NextResponse.json({
        identificado: true,
        confirmado: false,
        motivo: "data_nascimento_incorreta",
      }),
    };
  }

  await freio.registrar(telefone, true);
  return { ok: true, paciente };
}
