import { test } from "node:test";
import assert from "node:assert/strict";

import { podeFazer } from "../src/lib/rbac-matriz.ts";

/**
 * A matriz de autorização é a decisão mais barata de testar e a mais cara de
 * errar. Cada asserção aqui é uma frase do contrato/LGPD, não uma preferência.
 */

test("recepção NÃO lê texto clínico — decisão travada do DRAFT §0.4", () => {
  assert.equal(podeFazer("recepcao", "ler_texto_clinico"), false);
  assert.equal(podeFazer("medico", "ler_texto_clinico"), true);
  assert.equal(podeFazer("admin", "ler_texto_clinico"), true);
});

test("só médico cria entrada de prontuário", () => {
  assert.equal(podeFazer("medico", "criar_entrada_prontuario"), true);
  assert.equal(podeFazer("recepcao", "criar_entrada_prontuario"), false);
  assert.equal(podeFazer("admin", "criar_entrada_prontuario"), false);
});

test("auditoria e expurgo são exclusivos do admin", () => {
  for (const acao of ["ver_auditoria", "expurgo_logico"] as const) {
    assert.equal(podeFazer("admin", acao), true);
    assert.equal(podeFazer("recepcao", acao), false);
    assert.equal(podeFazer("medico", acao), false);
  }
});

test("médico não gere estoque, financeiro nem agenda", () => {
  for (const acao of ["gerir_estoque", "gerir_financeiro", "gerir_agenda"] as const) {
    assert.equal(podeFazer("medico", acao), false, `médico não deveria ${acao}`);
  }
});

test("fila de escalonamento é visível e atendível pelos três papéis", () => {
  for (const papel of ["recepcao", "medico", "admin"] as const) {
    assert.equal(podeFazer(papel, "ver_escalonamento"), true);
    assert.equal(podeFazer(papel, "gerir_escalonamento"), true);
  }
});
