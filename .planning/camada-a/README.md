# Camada A — delta

Implementa o que faltava do documento "EXODUS — Camada A v1.0". O que já existia
(máquina de estados de agendamento, outbox, opt-out, auditoria) não foi reescrito.

| Arquivo | O que entrega |
|---|---|
| `001-catraca.sql` | Tese 2 — validação como catraca. `fn_motivo_barrado` + `v_fila_disparo` / `v_barrados_validacao` |
| `002-estados-e-payload.sql` | §5 estados `recusada`/`sem_resposta`/`escalado_humano`, escalada em 2 falhas, e `fn_payload_lembrete` (§4.3, o envelope lacrado) |
| `003-lead.sql` | Tese 1 — lead como delta em `contatos_whatsapp` + role `app_marketing` sem acesso a dado de saúde |
| `004-telemetria.sql` | Tese 4/5 — `templates` versionados, `intencao` como enum do §8, views do §9 e §10 |
| `005-contract-test.sql` | 11 garantias. `BEGIN … ROLLBACK`, não deixa lixo |

## Ordem de aplicação num Postgres limpo

Descoberta ao rodar isto de verdade num branch Neon vazio (2026-08-31). Sem esta
ordem, cada arquivo falha por dependência ausente.

```
1. tabela clinicas                          (sql/schema-consultas.sql, só o CREATE de clinicas)
2. .planning/seguranca/000-roles.sql        (app_painel/app_n8n antes de qualquer GRANT)
3. sofia-demo/sql/schema-agendamentos-bella.sql
4. sofia-demo/sql/DRAFT-prontuario-modelo.sql   (usuarios, pacientes, contatos, vínculos)
5. seed de clinicas (a de teste é id=2, Bella)
6. .planning/agenda-turnos/sql/001-agenda-turnos.sql   (profissionais, servicos, clinicas.timezone)
7. .planning/reativacao/sql/001-reativacao.sql
8. .planning/reativacao/sql/004-consentimento.sql      (marketing_optin, livro-razão)
9. .planning/bot-agendamento/sql/001-bot-agendamento.sql (papel/nivel, eventos, mensagens_bot, interacoes)
10. camada-a/sql/001 → 004
11. camada-a/sql/005-contract-test.sql
```

⚠️ `sql/schema-consultas.sql` tem uma tabela `pacientes` ANTIGA e incompatível com a
de `DRAFT-prontuario-modelo.sql`. Aplicar o arquivo inteiro quebra tudo — só o
`CREATE TABLE clinicas` dele é aproveitável.

## Estado da verificação

Rodado em 2026-08-31 contra o branch Neon descartável `camada-a-test`
(`br-calm-lake-ay9oqjvp`): as 11 garantias passam, e as 4 migrações são
idempotentes (aplicadas 3× seguidas sem erro).

⚠️ Esse branch saiu do projeto `super-wildflower-31318091`, que estava
**deprecado** — o `.neon` do repo apontava para lá. O banco em uso é
`exodus-br` / `steep-scene-78058640` (São Paulo, PG 18). A prova continua
valendo (o schema foi montado do zero, independe de projeto), mas **estas
migrações ainda NÃO foram aplicadas no `exodus-br`**.

Dois bugs foram encontrados PELO teste e corrigidos:

- **`AFTER UPDATE OF status` não disparava na escalada automática.** A cláusula
  `OF` olha as colunas do `SET`, não o que um trigger `BEFORE` mudou — então a
  escalada por `falhas_classificacao` nunca entrava no livro-razão. Trocado por
  `AFTER UPDATE ... WHEN (NEW.status IS DISTINCT FROM OLD.status)`.
- **`ALTER COLUMN intencao TYPE` quebrava na 2ª execução**, porque o `USING`
  comparava o enum com `text[]`. Guardado por `information_schema`.
