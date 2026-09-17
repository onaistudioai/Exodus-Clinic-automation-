# QA-RUNBOOK — Módulo Estoque (Fase 4)

> Sem framework de teste no `aios-painel` e com banco **só em produção** (sem staging),
> a QA é feita em 3 camadas. As camadas A/B rodam via o runner SQL; a C é manual ao vivo
> (exercita o código TS real da baixa). Tudo na clínica **Bella = 2**.

## Pré-requisitos

1. Migration aplicada: `sql/001-estoque.sql` (ver etapa 1).
2. `N8N_API_KEY` no env (cofre `D:\projetos\.credentials\exodus\n8n.env`).

## Camada A — Seed de teste (L3)

```
node D:\projetos\Demo\sofia-demo\sql\_run-sql.mjs D:\projetos\Demo\aios-painel\.planning\estoque\sql\seed-teste.sql
```
Esperado: `status=seed ok`, `produtos=3`, `lotes=3`, `bom_itens=3`.

Cenário criado (tipo de atendimento `procedimento`):
| Produto | Estoque | BOM consome | Resultado esperado da baixa |
|---|---|---|---|
| [TESTE] Luva Nitrílica | L-PERTO=3 (vence +20d), L-LONGE=50 (+200d) | 5 | FEFO: 3 do L-PERTO (→0) + 2 do L-LONGE (→48) |
| [TESTE] Anestésico | A-1=20 | 2 | 18 |
| [TESTE] Gaze Estéril | sem lote | 1 | DIVERGÊNCIA: lote sentinela `DIVERGENCIA` em -1, mov motivo='divergencia' |

Custo esperado da baixa = (3×10) + (2×12) + (2×5,50) + (1×0) = **65,00**.

## Camada B — Teste de contrato do modelo (auto-verificável)

```
node D:\projetos\Demo\sofia-demo\sql\_run-sql.mjs D:\projetos\Demo\aios-painel\.planning\estoque\sql\003-contract-test.sql
```
Esperado: `status=CONTRACT TEST PASSED (rolled back, sem lixo)`. Qualquer falha vira erro
`FALHA(n)...`. Cobre: append-only, CHECK quantidade<>0, FEFO, RLS fail-closed, RLS
isolamento entre clínicas, invariante de reconciliação.

## Camada C — E2E da baixa automática (código TS real, ao vivo)

Exercita `estoque.baixarPorAtendimento` via o fluxo real do prontuário. Roda no painel.

1. Login como **médico** da clínica Bella (RBAC `criar_entrada_prontuario`).
2. Abrir um paciente da Bella **com um agendamento** vinculado.
3. Registrar atendimento **tipo `procedimento`** (texto clínico qualquer) e finalizar.
4. **Verificar** (via runner, `SET app.clinica_id='2'`):
   - `SELECT * FROM movimentacoes_estoque WHERE entrada_prontuario_id = <id> ORDER BY id;`
     → 2 linhas 'consumo' da luva (−3 L-PERTO, −2 L-LONGE), 1 'consumo' anestésico (−2),
       1 'divergencia' gaze (−1).
   - Saldos: luva L-PERTO=0, L-LONGE=48, anestésico=18, gaze=−1.
   - Custo: tela `/estoque/relatorio` no período → procedimento = R$ 65,00.
5. **Teste M2 (trava de reconsumo):** registrar uma **2ª entrada NOVA** para o **mesmo
   agendamento** (sem ser correção). Esperado: **nenhuma** nova movimentação de estoque
   (kit não consome de novo); saldos inalterados. Conferir com a query do passo 4.
6. **Teste C4 (correção não reconsome):** corrigir uma entrada finalizada → não gera baixa.

## Cleanup do seed/E2E

Movimentações são append-only (não dá DELETE). Para re-rodar do zero, limpar nesta ordem
com `SET app.clinica_id='2'`:
```sql
-- libera o append-only só para a limpeza de TESTE (rodar como dono):
ALTER TABLE movimentacoes_estoque DISABLE TRIGGER t_mov_append_only;
DELETE FROM movimentacoes_estoque
 WHERE produto_id IN (SELECT id FROM produtos WHERE nome LIKE '[TESTE]%');
ALTER TABLE movimentacoes_estoque ENABLE TRIGGER t_mov_append_only;
-- depois rode seed-teste.sql de novo (ele já limpa lotes/produtos/BOM de teste).
```
