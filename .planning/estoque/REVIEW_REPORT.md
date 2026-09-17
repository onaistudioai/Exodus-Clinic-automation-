# REVIEW_REPORT — Módulo Estoque

> **Fase 3 — REVIEWER (OPUS).** Data: 2026-06-21 · Branch: `feat/estoque`
> Escopo: 12 arquivos novos/alterados + migration. Gate: **zero HIGH para avançar.**

## Veredito: ✅ APROVADO (0 HIGH) — 3 MEDIUM, 4 LOW

`tsc` e `next build` verdes. Multi-tenant e RBAC corretos. Nenhum bloqueador.

---

## 🔴 HIGH — nenhum

Checagens que passaram:
- **SQL injection:** 100% das queries são parametrizadas, incluindo `($1 || ' days')::interval` e `LIMIT $2`. ✅
- **Multi-tenant:** toda query usa `current_setting('app.clinica_id')::int` e roda dentro de `withTenant`/`withTenantReadOnly`; RLS FORCE + policy nas 4 tabelas; `clinica_id` nunca vem do cliente. ✅
- **RBAC:** páginas e actions com `requireAcao` correto (`ver_estoque` leitura, `gerir_estoque` escrita, `configurar_bom` admin). ✅
- **Append-only:** `movimentacoes_estoque` sem grant de UPDATE/DELETE + trigger; correção é estorno/ajuste. ✅
- **Não regride prontuário (C4):** baixa isolada por `SAVEPOINT`; falha → `ROLLBACK TO SAVEPOINT`, atendimento finaliza. ✅
- **Concorrência FEFO:** `SELECT ... FOR UPDATE` serializa consumo do mesmo produto (sem double-spend). ✅

---

## 🟠 MEDIUM (corrigir se possível; não bloqueia)

### M1 — Aritmética de quantidade/custo em float (JS) escrita em NUMERIC
`estoque.repo.ts` lê `NUMERIC` como `float8` e faz a baixa em JS (`consumir = Math.min(...)`, `custoTotal += consumir * custo`), gravando de volta em `NUMERIC(12,2/4)`. Com 2 casas é tolerável (o banco arredonda), mas em escala pode haver drift de centavos no custo.
- **Impacto:** baixo hoje (NUMERIC(12,2)); cresce com volume.
- **Fix sugerido:** fazer o decremento e o somatório de custo em SQL (NUMERIC) — ex.: `RETURNING` o custo do `UPDATE`, somar no banco. Deixar JS só para orquestrar o FEFO. Aceitável adiar para v1.1.

### M2 — Reconsumo se médico criar 2ª entrada NOVA para o mesmo agendamento
A baixa roda em toda entrada nova finalizada (correção é pulada, ✅). Mas duas entradas *novas* para o mesmo `agendamento_id` consumiriam o kit duas vezes.
- **Impacto:** raro (fluxo normal = 1 atendimento por agendamento); o trigger já marca 'realizada' na 1ª.
- **Fix sugerido:** guardar contra baixa duplicada por `agendamento_id` (ex.: não baixar se já há movimentação `consumo` para aquele agendamento) — ou aceitar como decisão de v1 (documentado).

### M3 — Lote sentinela de divergência pode duplicar sob concorrência
Quando um produto sem nenhum lote sofre baixa, cria-se um lote `'DIVERGENCIA'`. Dois atendimentos simultâneos do mesmo produto-sem-lote poderiam criar dois sentinelas (não há FOR UPDATE possível em linha inexistente).
- **Impacto:** baixo (cosmético — saldo total continua correto; invariante mantida).
- **Fix sugerido:** aceitável; se incomodar, consolidar sentinelas num job de limpeza.

---

## 🟢 LOW (sugestões)

- **L1 — `if (delta === 0) return` em `ajustarInventario`** usa comparação exata de float; um delta ~1e-15 passaria. Usar epsilon (como o `> 0.0000001` da baixa).
- **L2 — `listarAlertas` monta em JS** (níveis + lotes) em vez de UNION no SQL. Legível e O(2 queries); ok manter.
- **L3 — Seed de teste vazio na migration.** Necessário popular para o E2E (Fase 4) — produto + lote + BOM na clínica Bella (2).
- **L4 — eslint do projeto quebrado** (eslintrc×flat, circular JSON na carga) — pré-existente, não checa nada. Fora do escopo deste módulo, mas vale abrir issue separada.

---

## Conformidade com o SPEC

| Item | Status |
|---|---|
| 4 tabelas + RLS + append-only | ✅ |
| FEFO | ✅ |
| Política C3 (nunca aborta atendimento) | ✅ (SAVEPOINT + baixa parcial/saldo negativo) |
| BOM por `tipo_atendimento` | ✅ |
| Custo por procedimento | ✅ |
| RBAC novas ações | ✅ |
| Alertas (ruptura/validade/saldo negativo) | ✅ |

**Recomendação:** seguir para Fase 4 (QA/testes) e validação E2E. M1/M2 podem virar itens de v1.1 ou entrar no FIXER conforme sua escolha.
