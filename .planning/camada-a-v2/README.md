# Camada A v2 — guardrail, destino da escalada e fila reversa

Fatia §11 itens **1, 3 e 4** do documento "Camada A v2.0". Os outros sete itens
(observabilidade, painel de resultado, recall, tenant_config, follow-up de orçamento,
experimento, LGPD operacional) estão fora desta entrega.

| Arquivo | Item | O que entrega |
|---|---|---|
| `001-guardrail.sql` | 1 | `fn_triagem_clinica`, `fn_chat_bloqueado`, `fn_guardrail` |
| `002-destino-escalada.sql` | 3 | SLA por clínica, `prazo_em`, `v_fila_escalonamento`, `fn_fora_do_horario` |
| `003-fila-reversa.sql` | 4 | `lista_espera`, `ofertas_vaga`, cascata de um por vez, `fn_payload_oferta` |
| `004-contract-test.sql` | — | 8 garantias, `BEGIN … ROLLBACK` |

Painel: `/escalonamentos` (fila com prazo, assumir, resolver) +
`src/server/escalonamentos.repo.ts` + duas ações em `src/lib/rbac.ts`.

## O que NÃO foi reescrito

`reativacao/007-escalonamentos.sql` já tinha a tabela com os 7 gatilhos do Anexo I §5,
o anti-flood por chat e `abrir_escalonamento()`. O pouso da escalada estava pronto —
faltava quem chama, e faltava prazo.

## As duas metades do guardrail

`fn_triagem_clinica` é um **piso determinístico**, não um detector completo. Um léxico
garante que a família óbvia de frase clínica não chegue ao bot; não garante que nenhuma
chegue.

A metade que sustenta a garantia é `fn_chat_bloqueado`: **escalada é porta de mão
única**. Enquanto houver item aberto para o chat, o bot não responde nada — nem a uma
pergunta inocente. Isso limita o dano de um falso negativo a uma resposta, em vez de uma
conversa inteira. É também o que torna a verificação "separada" de fato: uma instrução
em prompt o modelo pode atropelar; um `IF` que decide se ele é chamado, não.

Resolver o item no painel é o que destrava o número.

## Integração n8n — ESPECIFICADA, NÃO APLICADA

O nó que chama o guardrail **não foi escrito nos workflows**. Motivo: os JSON locais
estão defasados em relação ao n8n vivo, e a regra do projeto é `GET` antes de `PUT` —
editar a cópia velha produziria um artefato falso. O n8n também não está acessível
nesta sessão.

Contrato para quem for aplicar, como primeiro nó depois do webhook:

```sql
SELECT fn_guardrail(:chat_id, :texto) AS g;
```

- `g->>'bloqueado' = true` ⇒ **não** chamar o router. Enviar acolhimento e encerrar.
  Se `fn_fora_do_horario(clinica_id)`, o acolhimento não promete retorno imediato.
- `g->>'bloqueado' = false` ⇒ fluxo normal.
- O classificador Groq do router pode **abrir** escalonamento adicional
  (`abrir_escalonamento`), nunca cancelar um aberto.

Worker de expiração da fila reversa, a cada minuto: `SELECT fn_expirar_ofertas();`

## Decisões travadas (§12 da v2)

| # | Decisão | Escolha |
|---|---|---|
| 1 | Prioridade da fila | Ordem de chegada. `criado_em` **é** a prioridade — não há coluna ajustável, porque a ordem precisa ser defensável quando um paciente perguntar por que o outro foi chamado antes |
| 3 | Teto de contato | 1 oferta por paciente por vaga (`uq_oferta_por_candidato`) |
| 4 | Política de vaga | `clinicas.politica_vaga`, default `avisa_recepcao` — automatizar oferta é ato explícito |
| 5 | SLA | `clinicas.sla_escalada_min`, default 30. Fora de horário derivado de `turnos`, fail-closed |

Os botões viraram colunas em `clinicas`, não `tenant_config` (item 7, fora de escopo).
Quando o item 7 for construído, migram para lá.

## Estado da verificação

Rodado em 2026-09-01 no branch Neon `camada-a-v2-test`: **8/8 garantias passam**, e as 3
migrações são idempotentes (aplicadas 2× seguidas, com o teste passando depois de cada).
Painel: `tsc --noEmit` limpo e build verde com `ƒ /escalonamentos`.

Ordem de montagem do schema base: `camada-a/README.md`, acrescentando
`reativacao/007-escalonamentos.sql` antes de `bot-agendamento/001`.

**O que a prova NÃO cobre.** Os gates do §11 exigem clínica rodando ("1 vaga recuperada
que teria morrido", "nenhuma conversa escalada sem resposta dentro do SLA"). Não há
produção — o Neon segue só com `neon_auth`. O contract-test prova a mecânica; o
comportamento com gente real continua em aberto até o go-live.
