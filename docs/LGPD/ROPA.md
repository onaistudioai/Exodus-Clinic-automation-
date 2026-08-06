# Registro das Operações de Tratamento (ROPA)

> Art. 37 da LGPD. Documento **interno** — não vai anexo ao contrato, mas é o que se apresenta à ANPD em caso de fiscalização ou incidente.
>
> Papel da CONTRATADA: **operadora**. Manter atualizado a cada novo módulo.

## Identificação

| | |
|---|---|
| **Operadora** | [CONTRATADA] — [CNPJ] |
| **Encarregado (DPO)** | [NOME] — [E-MAIL] |
| **Controladoras** | Clínicas contratantes (uma por tenant) |
| **Sistema** | AIOS / SOFIA |
| **Última revisão** | [DATA] |

## Operações

### 1. Agendamento e confirmação de consultas
- **Titulares:** pacientes
- **Dados:** nome, telefone, data/hora, profissional, serviço
- **Sensível:** sim — a existência da consulta já revela dado de saúde
- **Finalidade:** marcar, confirmar, lembrar e remarcar atendimento
- **Base legal:** art. 11, II, "f" (tutela da saúde)
- **Origem:** informado pelo paciente via WhatsApp ou registrado pela recepção
- **Compartilhamento:** Meta/WhatsApp (canal), Groq/Google (interpretação de intenção)
- **Retenção:** vigência + 5 anos
- **Controles:** RLS por clínica; confirmação de identidade antes de revelar horário

### 2. Prontuário eletrônico
- **Titulares:** pacientes
- **Dados:** anotações clínicas, procedimentos, materiais utilizados
- **Sensível:** sim
- **Finalidade:** registro do atendimento
- **Base legal:** art. 11, II, "f"
- **Compartilhamento:** nenhum. **Não trafega por WhatsApp nem por provedor de IA**
- **Retenção:** mínimo 20 anos (norma do CFM), prevalece sobre pedido de eliminação (art. 16, I)
- **Controles:** RBAC — apenas `medico` e `admin`; recepção não acessa texto clínico; `app_n8n` sem privilégio de leitura
- **Risco aceito:** sem criptografia em nível de campo — legível por administrador de banco. Mitigado por acesso restrito e criptografia em repouso do provedor

### 3. Reativação de pacientes (comunicação ativa)
- **Titulares:** pacientes inativos
- **Dados:** nome, telefone, data do último atendimento
- **Sensível:** sim
- **Finalidade:** convidar o paciente a retomar acompanhamento
- **Base legal:** **consentimento** (art. 11, I) — específico e destacado. *Não* se enquadra em tutela da saúde por ser comunicação ativa de iniciativa da clínica
- **Compartilhamento:** Meta/WhatsApp
- **Retenção:** consentimento e revogação registrados enquanto durar a relação + 5 anos (prova de licitude)
- **Controles:** registro de consentimento em tabela dedicada; trava contra recontato; opt-out honrado
- **Atenção:** disparo sem consentimento válido é infração. Cabe à clínica garantir a base

### 4. Gestão financeira
- **Titulares:** pacientes
- **Dados:** valores, cobranças, pagamentos, vínculo com procedimento
- **Sensível:** sim, por associação (o procedimento cobrado revela a condição de saúde)
- **Base legal:** execução de contrato (art. 7º, V) + obrigação legal fiscal (art. 7º, II)
- **Retenção:** conforme legislação tributária (mínimo 5 anos)

### 5. Controle de estoque
- **Titulares:** pacientes (indiretamente, pela baixa de material vinculada ao procedimento)
- **Base legal:** art. 11, II, "f" + legítimo interesse da clínica na gestão
- **Retenção:** 5 anos

### 6. Contas de usuários do sistema
- **Titulares:** profissionais e colaboradores da clínica
- **Dados:** nome, e-mail, hash de senha, perfil
- **Sensível:** não
- **Base legal:** execução de contrato
- **Retenção:** enquanto durar o vínculo + 1 ano (trilha de auditoria)

### 7. Registros de segurança
- **Dados:** e-mail tentado, endereço IP, horário, sucesso/falha
- **Finalidade:** prevenção de fraude e acesso não autorizado
- **Base legal:** legítimo interesse (art. 7º, IX) — segurança do titular e do sistema
- **Retenção:** 30 dias
- **Nota:** minimização deliberada; sem retenção indefinida

## Medidas de segurança

Ver [DPA §5](./DPA-clinica.md#5-medidas-técnicas-e-organizacionais). Prova automatizada do isolamento entre clínicas: `.planning/seguranca/002-contract-test.sql`.

## Riscos residuais registrados

| Risco | Severidade | Situação |
|---|---|---|
| Identificação do paciente por telefone, sem autenticação forte | Alta | Mitigado por confirmação de identidade adicional e por não trafegar conteúdo clínico no canal. Residual aceito |
| Texto clínico sem criptografia de campo | Média | Aceito. Mitigado por RBAC e criptografia em repouso |
| Conector de WhatsApp não oficial | Média | Tratado no contrato principal. Migração para API oficial recomendada |
| Transferência internacional a provedores de IA | Média | Minimização de payload; conteúdo clínico nunca enviado |

## Histórico

| Data | Alteração |
|---|---|
| [DATA] | Criação do registro |
