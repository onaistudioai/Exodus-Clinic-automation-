/**
 * Idade/menoridade calculada em runtime (NUNCA armazenada — muda com o tempo).
 * Espelha `fn_e_menor` do banco (DRAFT-prontuario-modelo.sql). Fonte única da regra
 * no front; o banco revalida via constraint/trigger e a action revalida no server.
 */
export const IDADE_MAXIMA = 120;

/** Idade em anos a partir de uma data ISO (YYYY-MM-DD), no fuso local. */
export function calcularIdade(nascISO: string, hoje: Date = new Date()): number {
  const [y, m, d] = nascISO.split("-").map(Number);
  if (!y || !m || !d) return NaN;
  let idade = hoje.getFullYear() - y;
  const aniversarioPassou =
    hoje.getMonth() + 1 > m || (hoje.getMonth() + 1 === m && hoje.getDate() >= d);
  if (!aniversarioPassou) idade -= 1;
  return idade;
}

export function eMenor(nascISO: string, hoje: Date = new Date()): boolean {
  return calcularIdade(nascISO, hoje) < 18;
}

/** Valida a data de nascimento: formato, não-futura, idade plausível (<=120). */
export function validarNascimento(
  nascISO: string,
  hoje: Date = new Date()
): { ok: true; idade: number } | { ok: false; erro: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nascISO)) {
    return { ok: false, erro: "Data de nascimento inválida." };
  }
  const nasc = new Date(nascISO + "T00:00:00");
  if (Number.isNaN(nasc.getTime())) {
    return { ok: false, erro: "Data de nascimento inválida." };
  }
  // Bloqueia futuro (compara só a parte de data).
  const hojeISO = hoje.toISOString().slice(0, 10);
  if (nascISO > hojeISO) {
    return { ok: false, erro: "Data de nascimento não pode ser no futuro." };
  }
  const idade = calcularIdade(nascISO, hoje);
  if (idade > IDADE_MAXIMA) {
    return { ok: false, erro: `Idade implausível (> ${IDADE_MAXIMA} anos). Confira a data.` };
  }
  return { ok: true, idade };
}
