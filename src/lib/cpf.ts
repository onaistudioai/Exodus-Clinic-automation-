import { createHash } from "crypto";

/**
 * CPF: opcional, único, DESAMBIGUA (não autentica). Guardamos só hash + last4.
 * Pepper FORA do banco (env CPF_PEPPER / secret Railway). Ver
 * DRAFT-prontuario-modelo.sql (pacientes.cpf_hash) e DRAFT-checkin-ux.md Caminho A.
 *
 *   cpf_hash  = sha256(cpf_normalizado || pepper)  (hex)  -> bate com uq_pac_cpf
 *   cpf_last4 = 2 últimos dígitos (CHAR(2) no schema; "pós-traço")
 */
function normalizarCpf(cpf: string): string {
  const so = cpf.replace(/\D/g, "");
  if (so.length !== 11) {
    throw new Error("CPF deve ter 11 dígitos.");
  }
  return so;
}

export function hashCpf(cpf: string): { cpfHash: string; cpfLast4: string } {
  const pepper = process.env.CPF_PEPPER;
  if (!pepper) {
    throw new Error("CPF_PEPPER ausente no ambiente — não dá pra hashear CPF com segurança.");
  }
  const norm = normalizarCpf(cpf);
  const cpfHash = createHash("sha256").update(norm + pepper).digest("hex");
  const cpfLast4 = norm.slice(-2); // schema usa CHAR(2)
  return { cpfHash, cpfLast4 };
}
