import { test } from "node:test";
import assert from "node:assert/strict";

// Pepper precisa existir antes do import (lido do env dentro da função).
process.env.CPF_PEPPER = "pepper-de-teste";
const { hashCpf } = await import("../src/lib/cpf.ts");

test("máscara não muda o hash — o que vale é o CPF normalizado", () => {
  const a = hashCpf("529.982.247-25");
  const b = hashCpf("52998224725");
  assert.equal(a.cpfHash, b.cpfHash);
  assert.equal(a.cpfLast4, "25");
});

test("pepper diferente muda o hash — dump vazado não reverte nem cruza bases", () => {
  const comPepperA = hashCpf("52998224725").cpfHash;
  process.env.CPF_PEPPER = "outro-pepper";
  const comPepperB = hashCpf("52998224725").cpfHash;
  process.env.CPF_PEPPER = "pepper-de-teste";
  assert.notEqual(comPepperA, comPepperB);
});

test("hash é sha256 hex — 64 caracteres", () => {
  assert.match(hashCpf("52998224725").cpfHash, /^[0-9a-f]{64}$/);
});

test("CPF com contagem errada de dígitos falha alto, não hasheia lixo", () => {
  assert.throws(() => hashCpf("1234567890"), /11 d/i);
  assert.throws(() => hashCpf(""), /11 d/i);
});

test("sem CPF_PEPPER a função recusa — fail-closed", () => {
  const salvo = process.env.CPF_PEPPER;
  delete process.env.CPF_PEPPER;
  assert.throws(() => hashCpf("52998224725"), /CPF_PEPPER/);
  process.env.CPF_PEPPER = salvo;
});
