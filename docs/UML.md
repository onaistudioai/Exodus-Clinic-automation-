# UML

Diagramas tirados do código: as migrations em `.planning/*/sql/*.sql`, o schema
compartilhado com a SOFIA em `sofia-demo/sql/` (repositório `Demo`), e
`src/lib/status-agendamento.ts`, `src/lib/rbac.ts`, `src/lib/tenant.ts`.
Mudou o schema, o papel ou a máquina de estado, atualize aqui.

As fontes PlantUML equivalentes estão em [`uml/`](uml/).

## Componentes

```mermaid
flowchart LR
  paciente(["Paciente"]) --> whatsapp["WhatsApp"]
  whatsapp --> waha["WAHA<br/>sessão por clínica"]
  recepcao(["Recepção"]) --> painel
  medico(["Profissional"]) --> painel
  admin(["Dono"]) --> painel

  subgraph n8n["n8n (SOFIA)"]
    router["Router<br/>intenção via Groq"]
    lembretes["Lembretes D-1 e D0"]
    worker["Worker de reativação"]
  end

  subgraph next["Next.js 16 (App Router)"]
    painel["Painel<br/>agenda, crm, checkin, prontuário,<br/>financeiro, estoque, reativação,<br/>aprovações, escalonamentos, chat"]
    apisofia["/api/sofia/*<br/>assinada com HMAC"]
    cron["/api/cron/retencao<br/>expurgo por prazo"]
    guardas["Guardas<br/>auth, session, rbac,<br/>tenant, api-guard, hmac"]
    dal["DAL + repos"]
  end

  db[("Postgres — Neon sa-east-1<br/>RLS por clinica_id")]
  groq["Groq llama-3.3-70b"]

  waha --> router
  router --> groq
  painel --> guardas
  apisofia --> guardas
  guardas --> dal
  cron --> dal
  dal -->|role app_painel| db
  router -->|role app_n8n — escrita direta| db
  lembretes --> db
  worker --> db
  router -.->|contrato pronto, não consumido| apisofia
```

A seta pontilhada é o achado central de `docs/RELATORIOS/MAPA-OPERACAO.md`
(repositório `Demo`): o contrato HMAC `/api/sofia/*` está construído dos dois
lados e ninguém o usa — a SOFIA grava por nó Postgres direto. A mesma tabela
acaba com dois donos e duas validações diferentes.

## Entidades e relacionamentos

O modelo completo (cerca de 40 tabelas) está em
[`uml/02-entidades.puml`](uml/02-entidades.puml). O núcleo:

```mermaid
erDiagram
  CLINICAS ||--o{ USUARIOS : "tem equipe"
  CLINICAS ||--o{ PACIENTES : atende
  CLINICAS ||--o{ CLINICA_CANAL : "fala por"
  PACIENTES ||--o{ PACIENTE_CONTATO : "alcançado por"
  CONTATOS_WHATSAPP ||--o{ PACIENTE_CONTATO : "aponta para"
  PACIENTES ||--o{ PACIENTE_RESPONSAVEL : "responde por"
  PACIENTES ||--o{ AGENDAMENTOS : marca
  PROFISSIONAIS ||--o{ AGENDAMENTOS : atende
  SERVICOS ||--o{ AGENDAMENTOS : "do tipo"
  PROFISSIONAIS ||--o{ TURNOS : "disponível em"
  PROFISSIONAIS |o--o{ BLOQUEIOS : ausente
  AGENDAMENTOS ||--o{ EVENTOS_AGENDAMENTO : registra
  AGENDAMENTOS |o--o{ PRONTUARIO_ENTRADAS : gera
  PACIENTES ||--o{ PRONTUARIO_ENTRADAS : "tem histórico"
  PRONTUARIO_ENTRADAS ||--o{ PRONTUARIO_ACESSOS : auditado
  PRONTUARIO_ENTRADAS |o--o{ FINANCEIRO_COBRANCAS : origina
  FINANCEIRO_COBRANCAS |o--o{ FINANCEIRO_LANCAMENTOS : liquidada
  PRONTUARIO_ENTRADAS |o--o{ MOVIMENTACOES_ESTOQUE : consome
  PRODUTOS ||--o{ LOTES : "tem saldo"
  LOTES |o--o{ MOVIMENTACOES_ESTOQUE : movimenta
  PACIENTES ||--o{ REATIVACAO_ALVOS : "alvo de"
  REATIVACAO_CAMPANHAS ||--o{ REATIVACAO_ALVOS : agrupa
  REATIVACAO_ALVOS ||--o{ REATIVACAO_ENVIOS : "foi contactado"
  CONTATOS_WHATSAPP ||--o{ CONSENTIMENTO_EVENTOS : consente
  PACIENTES ||--o{ CRM_TAREFAS : "tem pendência"

  CLINICAS {
    int id PK
    text nome
    text telefone
  }
  PACIENTES {
    int id PK
    int clinica_id FK
    text nome_completo
    date data_nascimento
    text cpf_hash "hash com pepper"
    text status
  }
  AGENDAMENTOS {
    int id PK
    int clinica_id FK
    text chat_id
    date data_agendamento
    time hora_agendamento
    text status FK
  }
  PRONTUARIO_ENTRADAS {
    int id PK
    text estado
    text texto_clinico "nunca vai à IA"
  }
  FINANCEIRO_LANCAMENTOS {
    bigint id PK
    text tipo
    numeric valor
  }
```

Três livros são **append-only** por trigger, não por disciplina de quem
escreve: `financeiro_lancamentos`, `movimentacoes_estoque` e
`consentimento_eventos` (mais `chat_chamadas` e `prontuario_acessos`, que são
trilhas de auditoria). Correção é linha nova — estorno, ajuste, novo evento.

Ficam fora do isolamento por tenant, por não serem dado de clínica:
`papel`, `acao`, `papel_acao` (catálogo RBAC), `estado_*` e `transicao_*`
(máquinas de estado), `funcao_alcance` (alcance dos jobs) e as tabelas de
rate-limit `login_tentativas` / `identidade_tentativas`.

## Estados do agendamento

```mermaid
stateDiagram-v2
  [*] --> reservada : SOFIA segura o horário
  [*] --> agendada : marcado no balcão
  reservada --> confirmada
  reservada --> cancelada
  reservada --> expirada
  reservada --> recusada
  agendada --> confirmada
  agendada --> cancelada
  agendada --> remarcada
  agendada --> recusada
  agendada --> sem_resposta : silêncio no lembrete D-1
  sem_resposta --> confirmada
  sem_resposta --> cancelada
  confirmada --> realizada
  confirmada --> no_show
  confirmada --> cancelada
  confirmada --> remarcada
```

Silêncio não é fim: de `sem_resposta` o paciente ainda volta para
`confirmada`. Terminais: `cancelada`, `remarcada`, `realizada`.

A lista vive em `estado_agendamento` e as transições em
`transicao_agendamento` — nenhum `CHECK`, `CASE` ou união de TypeScript
repete isso sem derivar daqui. Foi exatamente assim que `pendente` e
`remarcacao_pendente` sobreviveram nos filtros dos workflows depois de
sumirem do banco, e as consultas passaram a voltar zero linhas em silêncio.

## Estados da solicitação

```mermaid
stateDiagram-v2
  [*] --> pendente : pedido com argumentos (JSONB)
  pendente --> aprovada : outra pessoa aprova
  pendente --> negada : outra pessoa nega
  pendente --> expirada : passou de expira_em (48h)
  aprovada --> [*]
  negada --> [*]
  expirada --> [*]
```

Vale para as duas filas: `solicitacao_aprovacao` (ação sensível pedida por
quem não pode executá-la) e `solicitacao_paciente` (pedido do WhatsApp que o
vínculo não autoriza). Quem decide não pode ser quem pediu — auto-aprovação
transformaria a fila num carimbo. O aprovador executa os `argumentos`
gravados, nunca uma reconstrução a partir do texto.

## Sequência: paciente marca pelo WhatsApp

```mermaid
sequenceDiagram
  actor Paciente
  participant W as WAHA
  participant R as n8n · Router SOFIA
  participant G as Groq
  participant DB as Postgres
  participant P as Painel

  Paciente->>W: mensagem
  W->>R: webhook (chat_id, texto)
  R->>DB: clinica_canal pelo identificador da sessão
  DB-->>R: clinica_id
  R->>DB: sofia_conversas (memória)
  R->>G: classifica intenção, extrai data/hora/serviço
  G-->>R: campos
  alt vínculo ativo e maior de idade
    R->>DB: agendamentos_sofia_demo (reservada)
    R->>DB: eventos_agendamento (origem bot)
    R-->>Paciente: confirma o horário
  else menor, ou vínculo insuficiente
    R->>DB: solicitacao_paciente (pendente)
    R-->>Paciente: "vou passar para a recepção"
    P->>DB: recepção decide na fila
  else sintoma clínico, reclamação, pediu humano
    R->>DB: escalonamentos (gatilho, trecho)
    R-->>Paciente: avisa que uma pessoa assume
  end
```

O identificador da sessão do WAHA é a chave de entrada do tenant. O número
formatado nunca é chave: `+55 11 9…` e `5511 9…` são o mesmo telefone e
viram bug de comparação.

## Sequência: atendimento e o que ele dispara

```mermaid
sequenceDiagram
  actor Med as Profissional
  participant P as Painel
  participant Guard as RBAC + tenant
  participant DB as Postgres

  Med->>P: abre o prontuário
  P->>Guard: sessão -> {usuario_id, clinica_id, papel}
  Guard->>DB: SET app.clinica_id
  Guard->>DB: papel_acao permite 'ler_texto_clinico'?
  DB-->>Guard: sim (medico, admin)
  Guard->>DB: prontuario_acessos (leu)
  Med->>P: registra o atendimento
  P->>Guard: 'criar_entrada_prontuario' (escrita + sensível)
  alt papel = medico
    P->>DB: prontuario_entradas (rascunho -> finalizado)
    P->>DB: financeiro_cobrancas pelo preço vigente
    P->>DB: baixa de estoque pela BOM (lotes FEFO)
    P->>DB: movimentacoes_estoque (append-only)
  else admin ou recepção
    Guard-->>P: negado — vira solicitacao_aprovacao
  end
```

`criar_entrada_prontuario` é só do médico: o dono da clínica lê o prontuário
mas não escreve nele. Ter o login mais forte não faz de ninguém autor de ato
clínico.

## Isolamento por clínica

Não existe lista de tabelas protegidas: `.planning/seguranca/001-lockdown.sql`
varre o `pg_catalog` atrás da coluna `clinica_id` e aplica em cada uma que
achar:

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE  ROW LEVEL SECURITY;
CREATE POLICY rls_tenant ON <t>
  USING      (clinica_id = NULLIF(current_setting('app.clinica_id', true), '')::int)
  WITH CHECK (clinica_id = NULLIF(current_setting('app.clinica_id', true), '')::int);
```

É **fail-closed**: sem o GUC na sessão, `current_setting` devolve vazio,
`NULLIF` devolve `NULL`, a comparação nunca é verdadeira e a consulta traz
zero linhas. Esquecer de setar o tenant fecha o banco em vez de abrir. E é
**FORCE**: nem o dono da tabela escapa da política — o app usa a role
`app_painel`, que é `NOBYPASSRLS`.

A role `app_n8n`, usada pela SOFIA, tem grant em poucas tabelas. Há uma
contradição em aberto registrada em `MAPA-OPERACAO.md` §2.4: os workflows
escrevem em `agendamentos_sofia_demo`, que não aparece nessa lista de grant.
`sofia-demo/sql/_diag1.sql` responde isso contra o banco vivo.
