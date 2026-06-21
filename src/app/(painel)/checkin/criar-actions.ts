"use server";

import { requireAcao } from "@/lib/rbac";
import { verifySession } from "@/lib/dal";
import { withTenant } from "@/lib/tenant";
import { hashCpf } from "@/lib/cpf";
import { validarNascimento, eMenor } from "@/lib/idade";
import * as pacientes from "@/server/pacientes.repo";
import type { RelacaoResponsavel } from "@/types/domain";

export interface CriarState {
  ok?: boolean;
  pacienteId?: number;
  nome?: string;
  erro?: string;
  campo?: string; // campo culpado (p/ realçar no form)
}

const RELACOES = ["mae", "pai", "tutor", "outro"] as const;

/**
 * Cria paciente NOVO (DRAFT-checkin-ux.md). Travas aplicadas no server (fonte da
 * verdade), além do banco:
 *  - data de nascimento não-futura e idade plausível (<=120);
 *  - CPF opcional → guarda só hash+last4; CPF duplicado na clínica é barrado (uq_pac_cpf);
 *  - MENOR (<18) exige responsável + consentimento; cria responsável (paciente) e o
 *    vínculo `paciente_responsavel` na MESMA transação (tudo ou nada).
 * Tudo dentro de withTenant → RLS amarra ao clinica_id da sessão.
 */
export async function criarPaciente(
  _prev: CriarState,
  formData: FormData
): Promise<CriarState> {
  await requireAcao("checkin");
  const session = await verifySession();

  const nome = String(formData.get("nome") ?? "").trim();
  const nasc = String(formData.get("data_nascimento") ?? "").trim();
  const cpf = String(formData.get("cpf") ?? "").trim();

  if (nome.length < 3) return { erro: "Informe o nome completo.", campo: "nome" };

  const v = validarNascimento(nasc);
  if (!v.ok) return { erro: v.erro, campo: "data_nascimento" };

  // CPF opcional → hash + last4
  let cpfHash: string | null = null;
  let cpfLast4: string | null = null;
  if (cpf) {
    try {
      const h = hashCpf(cpf);
      cpfHash = h.cpfHash;
      cpfLast4 = h.cpfLast4;
    } catch (e) {
      return { erro: e instanceof Error ? e.message : "CPF inválido.", campo: "cpf" };
    }
  }

  // Menor → coleta responsável
  const menor = eMenor(nasc);
  let resp: {
    nome: string;
    nasc: string;
    relacao: RelacaoResponsavel;
  } | null = null;

  if (menor) {
    const rNome = String(formData.get("resp_nome") ?? "").trim();
    const rNasc = String(formData.get("resp_data_nascimento") ?? "").trim();
    const rRelacao = String(formData.get("resp_relacao") ?? "") as RelacaoResponsavel;
    const consentimento = formData.get("consentimento") === "on";

    if (rNome.length < 3)
      return { erro: "Paciente menor: informe o responsável.", campo: "resp_nome" };
    const rv = validarNascimento(rNasc);
    if (!rv.ok) return { erro: `Responsável: ${rv.erro}`, campo: "resp_data_nascimento" };
    if (eMenor(rNasc))
      return { erro: "O responsável não pode ser menor de idade.", campo: "resp_data_nascimento" };
    if (!RELACOES.includes(rRelacao))
      return { erro: "Selecione a relação do responsável.", campo: "resp_relacao" };
    if (!consentimento)
      return { erro: "Registre o consentimento do responsável.", campo: "consentimento" };

    resp = { nome: rNome, nasc: rNasc, relacao: rRelacao };
  }

  try {
    // Tudo em UMA transação (mesmo tenant): paciente + (se menor) responsável + vínculo.
    const pacienteId = await withTenant(session.clinica_id, async (tx) => {
      const id = await pacientes.criar(tx, {
        nome,
        dataNascimento: nasc,
        cpfHash,
        cpfLast4,
        criadoPor: session.usuario_id,
      });
      if (resp) {
        await pacientes.vincularResponsavel(tx, id, {
          nome: resp.nome,
          dataNascimento: resp.nasc,
          relacao: resp.relacao,
          consentimentoPor: session.usuario_id,
        });
      }
      return id;
    });

    return { ok: true, pacienteId, nome };
  } catch (e: unknown) {
    // 23505 = unique_violation (uq_pac_cpf → CPF já cadastrado nesta clínica)
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "23505") {
      return { erro: "Já existe paciente com este CPF nesta clínica.", campo: "cpf" };
    }
    return { erro: e instanceof Error ? e.message : "Falha ao criar paciente." };
  }
}
