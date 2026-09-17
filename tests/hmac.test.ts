import { test } from "node:test";
import assert from "node:assert/strict";

// Segredos precisam existir ANTES do primeiro import que leia o env (cache lazy).
const SEGREDO_1 = "a".repeat(32);
const SEGREDO_2 = "b".repeat(32);
process.env.SOFIA_HMAC_SECRETS = `1:${SEGREDO_1},2:${SEGREDO_2}`;

const { verificarAssinatura, gerarAssinatura, JANELA_SEGUNDOS } = await import(
  "../src/lib/hmac.ts"
);
const { normalizarTelefone } = await import("../src/lib/telefone.ts");

const AGORA = 1_800_000_000;
const CORPO = JSON.stringify({ telefone: "5548999998888", acao: "agendar" });

test("assinatura válida resolve o tenant pelo segredo usado", () => {
  const r = verificarAssinatura(
    CORPO,
    gerarAssinatura(SEGREDO_2, CORPO, AGORA),
    String(AGORA),
    AGORA
  );
  assert.deepEqual(r, { ok: true, clinicaId: 2 });
});

test("o corpo NÃO consegue forjar o tenant: quem manda é o segredo", () => {
  // Corpo diz clinica_id 2, mas foi assinado com o segredo da clínica 1.
  const corpoMentiroso = JSON.stringify({ clinica_id: 2, acao: "agendar" });
  const r = verificarAssinatura(
    corpoMentiroso,
    gerarAssinatura(SEGREDO_1, corpoMentiroso, AGORA),
    String(AGORA),
    AGORA
  );
  assert.equal(r.ok && r.clinicaId, 1);
});

test("assinatura de outro segredo é rejeitada", () => {
  const forjada = gerarAssinatura("z".repeat(32), CORPO, AGORA);
  assert.equal(verificarAssinatura(CORPO, forjada, String(AGORA), AGORA).ok, false);
});

test("corpo adulterado invalida a assinatura", () => {
  const sig = gerarAssinatura(SEGREDO_1, CORPO, AGORA);
  const adulterado = CORPO.replace("agendar", "cancelar");
  assert.equal(verificarAssinatura(adulterado, sig, String(AGORA), AGORA).ok, false);
});

test("replay fora da janela é rejeitado", () => {
  const sig = gerarAssinatura(SEGREDO_1, CORPO, AGORA);
  const depois = AGORA + JANELA_SEGUNDOS + 1;
  assert.equal(verificarAssinatura(CORPO, sig, String(AGORA), depois).ok, false);
  // dentro da janela ainda passa
  assert.equal(
    verificarAssinatura(CORPO, sig, String(AGORA), AGORA + JANELA_SEGUNDOS - 1).ok,
    true
  );
});

test("timestamp no futuro também é rejeitado", () => {
  const futuro = AGORA + JANELA_SEGUNDOS + 60;
  const sig = gerarAssinatura(SEGREDO_1, CORPO, futuro);
  assert.equal(verificarAssinatura(CORPO, sig, String(futuro), AGORA).ok, false);
});

test("trocar só o header de timestamp não reaproveita a assinatura", () => {
  // O ts entra na base assinada — mexer nele quebra a verificação.
  const sig = gerarAssinatura(SEGREDO_1, CORPO, AGORA);
  assert.equal(verificarAssinatura(CORPO, sig, String(AGORA + 1), AGORA).ok, false);
});

test("headers ausentes falham fechado", () => {
  assert.equal(verificarAssinatura(CORPO, null, String(AGORA), AGORA).ok, false);
  assert.equal(verificarAssinatura(CORPO, "abc", null, AGORA).ok, false);
  assert.equal(verificarAssinatura(CORPO, "abc", "nao-numero", AGORA).ok, false);
});

test("normalizarTelefone aceita JID do WAHA e máscara, recusa lixo", () => {
  assert.equal(normalizarTelefone("5548999998888@c.us"), "+5548999998888");
  assert.equal(normalizarTelefone("(48) 99999-8888"), "+5548999998888");
  assert.equal(normalizarTelefone("+55 48 3333-4444"), "+554833334444");
  assert.equal(normalizarTelefone("123"), null);
  assert.equal(normalizarTelefone("5501999998888"), null); // DDD inválido
});
