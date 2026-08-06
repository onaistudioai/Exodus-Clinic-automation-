/**
 * W2d — Telefone é a chave de identidade do paciente no WhatsApp.
 *
 * Como não existe login de paciente, resolver o número errado significa entregar
 * dado de saúde para a pessoa errada. Por isso o parser é estrito: na dúvida,
 * devolve null e a rota recusa em vez de adivinhar.
 *
 * ponytail: só BR (+55). Generalizar com libphonenumber se atender outro país.
 */
export function normalizarTelefone(bruto: string): string | null {
  // Aceita o JID do WAHA ("5548999998888@c.us"), com/sem '+', com/sem máscara.
  const digitos = bruto.split("@")[0].replace(/\D/g, "");

  // 55 + DDD(2) + numero(8 fixo | 9 celular)
  const n = digitos.startsWith("55") ? digitos : `55${digitos}`;
  if (n.length !== 12 && n.length !== 13) return null;

  const ddd = Number(n.slice(2, 4));
  if (ddd < 11 || ddd > 99) return null;

  return `+${n}`;
}
