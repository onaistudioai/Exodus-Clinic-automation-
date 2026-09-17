# Diagramas UML (PlantUML)

Fonte dos diagramas do sistema. A versão explicada em texto está em [`../UML.md`](../UML.md).

| Arquivo | O que mostra |
|---|---|
| `01-componentes.puml` | Componentes do sistema e como se ligam |
| `02-entidades.puml` | Entidades do banco e relacionamentos |
| `03-papeis-acoes.puml` | Matriz de papéis e ações (RBAC) |
| `04-estados-agendamento.puml` | Estados do agendamento |
| `05-estados-solicitacao.puml` | Estados da solicitação de aprovação e de identidade |
| `06-sequencia-agendamento-sofia.puml` | Paciente marca pelo WhatsApp, da SOFIA ao banco |
| `07-sequencia-checkin-prontuario.puml` | Check-in, atendimento, cobrança e baixa de estoque |
| `08-sequencia-reativacao.puml` | Campanha de reativação e consentimento |
| `09-isolamento-tenant.puml` | Isolamento por clínica (RLS, roles, GUC) |

De onde saem: as migrations em `.planning/*/sql/*.sql`, o schema compartilhado
em `sofia-demo/sql/` (repositório `Demo`) e o código em `src/lib/` e
`src/server/`. Mudou schema, papel ou máquina de estado, atualize aqui.

## Gerar as imagens

Precisa de Java e do `plantuml.jar` ([plantuml.com/download](https://plantuml.com/download)).

```bash
java -jar plantuml.jar -tsvg docs/uml/*.puml
```

Troque `-tsvg` por `-tpng` para PNG. No VS Code, a extensão PlantUML mostra a prévia com `Alt+D`.
