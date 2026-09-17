import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STATUS_AGENDAMENTO,
  STATUS_ROTULO,
  eStatusConhecido,
} from "../src/lib/status-agendamento.ts";

/**
 * Custo de teste de unidade, valor de teste de integração: pega "acrescentei um
 * status e esqueci o rótulo na UI" sem subir banco.
 *
 * A outra metade do contrato — a lista bater com o CHECK do banco — está em
 * tests/integration/schema-contract.test.ts, que precisa de DATABASE_URL.
 */

test("todo status tem rótulo", () => {
  for (const s of STATUS_AGENDAMENTO) {
    assert.ok(STATUS_ROTULO[s], `status "${s}" sem rótulo`);
    assert.ok(STATUS_ROTULO[s].txt.length > 0, `status "${s}" com rótulo vazio`);
  }
});

test("não sobra rótulo órfão de status que não existe mais", () => {
  for (const chave of Object.keys(STATUS_ROTULO)) {
    assert.ok(eStatusConhecido(chave), `rótulo "${chave}" não corresponde a status algum`);
  }
});

test("a lista não tem duplicata", () => {
  assert.equal(new Set(STATUS_AGENDAMENTO).size, STATUS_AGENDAMENTO.length);
});

test("eStatusConhecido separa o que veio do banco do que é lixo", () => {
  assert.equal(eStatusConhecido("confirmada"), true);
  assert.equal(eStatusConhecido("escalado_humano"), true);
  // valores do schema ANTIGO: se voltarem, é sinal de código velho escrevendo
  assert.equal(eStatusConhecido("pendente"), false);
  assert.equal(eStatusConhecido("remarcacao_pendente"), false);
});
