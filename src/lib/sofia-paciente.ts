import "server-only";
import { NextResponse } from "next/server";
import type { Tx } from "@/lib/db";
import { normalizarTelefone } from "@/lib/telefone";
import {
  resolverIdentidadeConfiavel,
  confirmarIdentidade,
  ehMenor,
  clinicaAtual,
  type PacienteIdentificado,
} from "@/server/identidade.repo";
import { freioIdentidadePg, type FreioIdentidade } from "@/server/freio-identidade.repo";
import {
  escalonarReconfirmacaoPg,
  type EscalonarReconfirmacao,
} from "@/server/escalonar-reconfirmacao.repo";
import {
  solicitarAprovacaoPacientePg,
  type SolicitarAprovacaoPaciente,
} from "@/server/solicitacao-paciente.repo";

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
  freio: FreioIdentidade = freioIdentidadePg,
  escalonar: EscalonarReconfirmacao = escalonarReconfirmacaoPg,
  solicitar: SolicitarAprovacaoPaciente = solicitarAprovacaoPacientePg
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

  const resolucao = await resolverIdentidadeConfiavel(tx, telefone);

  // Mesma resposta para "não cadastrado" e "ambíguo": não confirmamos a
  // existência de cadastro para quem ainda não provou identidade.
  if (resolucao.tipo === "desconhecido") {
    return {
      ok: false,
      resposta: NextResponse.json({ identificado: false, confirmado: false }),
    };
  }

  // Contato não confiável (número reciclado, nunca verificado no balcão, ou
  // verificação vencida há mais de 5 meses — ver fn_contato_confiavel).
  // Resposta tão neutra quanto "desconhecido": NÃO pode confirmar que existe
  // cadastro para este número. O balcão é avisado por fora (escalonamento);
  // conversar com a SOFIA nunca reconfirma nada — só o balcão reconfirma.
  //
  // LIMITE HONESTO: esta trava prova que o balcão foi avisado, não que quem
  // está no chat é a pessoa certa. Reconfirmar por chat provaria só que
  // alguém respondeu — quem mente continua passando por aqui até o balcão
  // conferir. A garantia real é humana, não deste código.
  if (resolucao.tipo === "a_reconfirmar") {
    await escalonar.abrir(resolucao.clinicaId, resolucao.chatId);
    return {
      ok: false,
      resposta: NextResponse.json({
        identificado: false,
        confirmado: false,
        motivo: "reconfirmar_identidade",
      }),
    };
  }

  const paciente = resolucao.paciente;

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

  // W2g, item 5: menor NUNCA é autoatendimento, mesmo com identidade confirmada
  // e nível suficiente. "A Sofia PROPÕE, o balcão DISPÕE" — ela não coleta
  // dado de menor por chat (consentimento/LGPD). Diferente de a_reconfirmar:
  // aqui a identidade JÁ foi provada, então dizer "identificado" não vaza
  // nada que o próprio remetente não tenha acabado de confirmar mandando a
  // data certa — o que se nega é o AUTOATENDIMENTO, não a existência do cadastro.
  if (await ehMenor(tx, paciente.pacienteId)) {
    await solicitar.abrir(await clinicaAtual(tx), {
      chatId: paciente.chatId,
      pacienteId: paciente.pacienteId,
      motivo: "menor_sem_autoatendimento",
      acaoPretendida: "autoatendimento_generico",
    });
    return {
      ok: false,
      resposta: NextResponse.json({
        identificado: true,
        confirmado: false,
        motivo: "encaminhado_recepcao",
      }),
    };
  }

  return { ok: true, paciente };
}
