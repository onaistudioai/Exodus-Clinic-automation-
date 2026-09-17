"use client";

import CountUp from "./CountUp";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Valor monetário (BRL) que anima de 0 até o total ao entrar em tela. */
export function AnimatedMoney({
  value,
  className,
  duration = 1.2,
}: {
  value: number;
  className?: string;
  duration?: number;
}) {
  return <CountUp to={value} duration={duration} format={brl} className={className} />;
}

/** Inteiro com separador de milhar pt-BR, anima ao entrar em tela. */
export function AnimatedCount({
  value,
  className,
  duration = 1.2,
}: {
  value: number;
  className?: string;
  duration?: number;
}) {
  return (
    <CountUp
      to={value}
      duration={duration}
      format={(n) => Math.round(n).toLocaleString("pt-BR")}
      className={className}
    />
  );
}
