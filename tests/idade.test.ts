import { test } from "node:test";
import assert from "node:assert/strict";

import { calcularIdade, eMenor, validarNascimento, IDADE_MAXIMA } from "../src/lib/idade.ts";

// `hoje` é injetável de propósito: teste de data que depende do relógio quebra
// sozinho em algum dia do ano, e aí ninguém confia mais na suíte.
const HOJE = new Date("2026-06-15T12:00:00");

test("idade normal", () => {
  assert.equal(calcularIdade("1990-01-10", HOJE), 36);
});

test("aniversário HOJE já conta o ano", () => {
  // A borda que erra por um: quem faz aniversário hoje já tem a idade nova.
  assert.equal(calcularIdade("2008-06-15", HOJE), 18);
  assert.equal(eMenor("2008-06-15", HOJE), false);
});

test("aniversário amanhã ainda NÃO conta", () => {
  assert.equal(calcularIdade("2008-06-16", HOJE), 17);
  assert.equal(eMenor("2008-06-16", HOJE), true);
});

test("menor de idade exige responsável — a regra que decide para quem a mensagem vai", () => {
  assert.equal(eMenor("2015-03-02", HOJE), true);
  assert.equal(eMenor("1980-03-02", HOJE), false);
});

test("29 de fevereiro não quebra o cálculo", () => {
  assert.equal(calcularIdade("2004-02-29", HOJE), 22);
});

test("data futura é recusada", () => {
  const r = validarNascimento("2027-01-01", HOJE);
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.erro : "", /futuro/i);
});

test("formato inválido é recusado, não adivinhado", () => {
  for (const ruim of ["15/06/1990", "1990-6-15", "", "ontem"]) {
    assert.equal(validarNascimento(ruim, HOJE).ok, false, `aceitou "${ruim}"`);
  }
});

test(`idade acima de ${IDADE_MAXIMA} é implausível`, () => {
  const r = validarNascimento("1850-01-01", HOJE);
  assert.equal(r.ok, false);
});

test("data válida devolve a idade junto", () => {
  const r = validarNascimento("1990-01-10", HOJE);
  assert.equal(r.ok, true);
  assert.equal(r.ok === true ? r.idade : -1, 36);
});
