# Subprocessadores

> Anexo ao [DPA](./DPA-clinica.md), item 6. **Precisa de autorização escrita da clínica.**
>
> ⚠️ Confirmar a coluna "Local" no painel de cada fornecedor **antes de assinar** — região é configuração, não característica fixa. Preencher `[DATA]` e a URL do DPA de cada fornecedor.

## Lista

| Fornecedor | Função | Dados que acessa | Local | Base p/ transferência internacional |
|---|---|---|---|---|
| **Neon** | Banco de dados PostgreSQL gerenciado | Todos os dados do sistema, incluindo prontuário | EUA (ou UE, conforme região escolhida) | Cláusulas contratuais do fornecedor (art. 33, II) |
| **Vercel** | Hospedagem do painel web | Dados em trânsito durante o processamento da requisição; logs de aplicação | EUA / edge global | Cláusulas contratuais do fornecedor |
| **Hetzner** | Servidor do automatizador (n8n) e do conector de WhatsApp | Mensagens trocadas com pacientes; dados de agendamento | Alemanha | Adequação equivalente — legislação da UE (GDPR) |
| **Meta / WhatsApp** | Canal de mensagens | Conteúdo das mensagens trocadas com o paciente | EUA / global | Termos do serviço; **a clínica deve ter ciência de que o conteúdo trafega pela infraestrutura da Meta** |
| **Groq** | Processamento de linguagem natural do agente de atendimento | Trecho da conversa enviado para interpretação | EUA | Termos do serviço |
| **Google (Gemini)** | Processamento de linguagem — contingência | Idem Groq | EUA | Termos do serviço |

## Pontos que exigem decisão da clínica

**1. Escolher a região do banco.** Se a Neon oferecer região na UE ou no Brasil, escolher a mais próxima reduz o risco jurídico e a latência. Decisão a tomar **antes** de criar o banco — migrar região depois exige recriar.

**2. Minimização no envio ao provedor de IA.** Hoje é enviado o trecho da conversa necessário para interpretar a intenção do paciente. **Nunca** enviar prontuário, diagnóstico ou histórico clínico ao provedor de IA. Verificar isso a cada alteração do prompt do agente.

**3. Retenção nos provedores de IA.** Confirmar e registrar por escrito a política de retenção e de uso para treinamento de cada provedor. Se a política permitir uso do conteúdo para treinamento, **isso é incompatível** com dado de saúde e o provedor precisa ser trocado ou o plano alterado para o tier que veda o uso.

**4. WhatsApp.** O conector em uso não é a API oficial da Meta. Além do risco de bloqueio (tratado no contrato principal), isso significa que o tratamento não está coberto pelos termos comerciais da Meta. Migrar para a API oficial (Cloud API) resolve tanto o risco de bloqueio quanto o enquadramento contratual.

## Pendências antes da assinatura

- [ ] Obter e arquivar o DPA da Neon
- [ ] Obter e arquivar o DPA da Vercel
- [ ] Obter e arquivar o AVV/DPA da Hetzner
- [ ] Registrar aceite dos termos de processamento do Groq
- [ ] Confirmar região de armazenamento de cada fornecedor
- [ ] Colher autorização escrita da clínica para esta lista

**Última atualização:** [DATA] · **Autorizado pela clínica em:** ____/____/______
