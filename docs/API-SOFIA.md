# API SOFIA — contrato n8n → painel

Substitui os nós Postgres dos workflows. O n8n **não fala mais com o banco**: toda operação passa por aqui, onde valem RLS, RBAC e auditoria.

## Autenticação

HMAC-SHA256. Três headers em toda requisição:

```
Content-Type: application/json
X-AIOS-Timestamp: <unix em SEGUNDOS>
X-AIOS-Signature: <hex(HMAC-SHA256("<timestamp>.<corpo>", segredo))>
```

- A base assinada é `timestamp + "." + corpo bruto`. O timestamp entra **dentro** da assinatura — trocar só o header não reaproveita nada.
- Janela de 5 minutos, nos dois sentidos (velho = replay, futuro = relógio adulterado).
- A **clínica é derivada do segredo** que assinou. Não existe campo `clinica_id` em nenhum corpo; se você mandar, é ignorado.
- Assine o corpo **exatamente como enviado**. Reserializar o JSON muda bytes e quebra a verificação.

### Segredo

Variável `SOFIA_HMAC_SECRETS` no painel, formato `clinicaId:segredo` separado por vírgula:

```
SOFIA_HMAC_SECRETS="2:f3a9...,7:b1c8..."
```

Gerar com `openssl rand -hex 32` (mínimo 32 caracteres, validado na inicialização). **Um segredo por clínica** — vazamento de um não expõe as outras.

### Nó Code do n8n (assinatura)

```js
const crypto = require('crypto');
const segredo = $env.AIOS_HMAC_SECRET;
const corpo = JSON.stringify($json.payload);
const ts = Math.floor(Date.now() / 1000);
const assinatura = crypto.createHmac('sha256', segredo)
  .update(`${ts}.${corpo}`, 'utf8').digest('hex');

return [{ json: { corpo, ts, assinatura } }];
```

No nó HTTP Request seguinte: **Body Content Type = Raw**, body = `{{ $json.corpo }}` (o mesmo string, não re-serializado), headers vindos de `$json.ts` e `$json.assinatura`.

## Identidade do paciente

Rotas que tocam dado de paciente exigem `telefone` **e** `data_nascimento`. O paciente é resolvido pelo telefone da conversa; não há como pedir dados de outra pessoa.

Fluxo típico: a SOFIA chama sem `data_nascimento`, recebe `motivo: "confirme_data_nascimento"` e o primeiro nome, pergunta ao paciente, e repete a chamada com a data.

`telefone` aceita o JID do WAHA (`5548999998888@c.us`), com ou sem máscara.

---

## Endpoints

Todos são `POST` e devolvem `401 {"erro":"nao_autorizado"}` se a assinatura falhar.

### `POST /api/sofia/disponibilidade`
Não exige identidade — agenda livre não é dado pessoal.

```json
{ "data": "2026-08-10", "servico_id": 3, "profissional_id": 1 }
```
`servico_id` e `profissional_id` são opcionais (padrão: primeiro serviço, todos os profissionais). A duração vem do serviço cadastrado, não do corpo.

→ `{ "data", "servico": {...}, "agenda": [{ "profissional_id", "profissional", "slots": [...] }] }`

### `POST /api/sofia/paciente`
```json
{ "telefone": "5548999998888@c.us", "data_nascimento": "1985-03-12" }
```
→ `{ "identificado", "confirmado", "primeiro_nome", "agendamentos": [{ "inicio","servico","profissional","status" }] }`

Devolve no máximo 5 agendamentos futuros. **Nunca** prontuário, valor ou histórico clínico.

### `POST /api/sofia/agendar`
```json
{ "telefone": "...", "data_nascimento": "1985-03-12",
  "servico_id": 3, "profissional_id": 1, "inicio": "2026-08-10T14:00:00-03:00" }
```
→ `200 { "ok": true, "agendamento_id": 812 }` · `409 { "erro": "horario_indisponivel" }` (a SOFIA reoferece)

Sem overbooking: furar a grade é decisão de balcão, com humano.

### `POST /api/sofia/confirmar`
```json
{ "telefone": "...", "data_nascimento": "...", "agendamento_id": 812, "acao": "confirmar" }
```
`acao`: `"confirmar"` ou `"cancelar"`.

→ `200 { "ok": true, "status": "confirmada" }` · `404 { "erro": "agendamento_indisponivel" }`

O 404 é resposta única para "não é seu", "não existe", "já passou" e "já cancelado" — distinguir viraria oráculo de agendamentos alheios.

### `POST /api/sofia/optout`
```json
{ "telefone": "5548999998888@c.us", "evidencia": "msg: PARAR" }
```
Aceita `chat_id` como alternativa ao telefone.

→ `{ "ok": true, "mudou": true }`

**Sem step-up de identidade, de propósito.** Revogar consentimento tem que ser tão fácil quanto dá-lo (art. 8º §5 da LGPD). Funciona mesmo para número sem paciente vinculado — quem recebeu mensagem indevida precisa conseguir sair.

---

## Códigos de resposta

| Código | Significado |
|---|---|
| 200 | Processado (ver `ok` no corpo para o resultado de negócio) |
| 400 | Corpo malformado ou campo faltando |
| 401 | Assinatura inválida, ausente ou fora da janela |
| 404 | Recurso não existe **ou** não pertence a este paciente/clínica |
| 409 | Conflito de agenda |

## Checklist da migração (Wave 3)

- [ ] Gerar segredo por clínica e configurar `SOFIA_HMAC_SECRETS` no painel
- [ ] Configurar `AIOS_HMAC_SECRET` no n8n
- [ ] **GET do workflow em produção antes de qualquer PUT** — os JSON locais estão defasados
- [ ] Trocar os nós Postgres por Code (assinatura) + HTTP Request, um workflow por vez
- [ ] E2E de WhatsApp real entre cada workflow
- [ ] Conferir a autenticação do webhook de entrada no n8n antes de virar a chave
- [ ] Só então: descomentar o `REVOKE` final em `.planning/seguranca/001-lockdown.sql`
