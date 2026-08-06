# Anexo de Tratamento de Dados Pessoais (DPA)

> **Minuta técnica para revisão jurídica.** Escrita por quem conhece a arquitetura, não por advogado. Os controles técnicos descritos aqui são verificáveis no código (referências ao final). **Não assine sem revisão de advogado** — o objeto é dado pessoal sensível de saúde.
>
> Preencher: `[CONTRATADA]`, `[CLÍNICA]`, `[CNPJ]`, `[DATA]`, `[E-MAIL DPO]`.

Anexo ao Contrato de Prestação de Serviços firmado entre **[CLÍNICA]** ("CONTRATANTE") e **[CONTRATADA]** ("CONTRATADA"), regulando o tratamento de dados pessoais nos termos da Lei nº 13.709/2018 (LGPD).

## 1. Papéis

1.1. A CONTRATANTE atua como **CONTROLADORA**: define as finalidades e os meios essenciais do tratamento dos dados de seus pacientes.

1.2. A CONTRATADA atua como **OPERADORA**: trata dados pessoais exclusivamente em nome e conforme instruções documentadas da CONTROLADORA.

1.3. A CONTRATADA **não** utiliza os dados de pacientes para finalidade própria, não os comercializa, não os cede a terceiros fora da lista do item 6, e não os emprega para treinamento de modelos de inteligência artificial próprios ou de terceiros.

## 2. Objeto do tratamento

| Item | Descrição |
|---|---|
| **Titulares** | Pacientes da CONTRATANTE e seus profissionais/colaboradores usuários do sistema |
| **Dados pessoais** | Nome, CPF, data de nascimento, telefone, e-mail, endereço |
| **Dados sensíveis** | Dados referentes à saúde: agendamentos, procedimentos, anotações de prontuário, materiais utilizados |
| **Finalidades** | Agendamento, confirmação e lembrete de consultas; registro de prontuário; controle de estoque; gestão financeira; comunicação de reativação autorizada |
| **Base legal (sensíveis)** | Art. 11, II, "f" da LGPD — tutela da saúde, em procedimento realizado por profissionais de saúde. Para comunicação de reativação/marketing: **consentimento específico e destacado** (art. 11, I) |
| **Duração** | Vigência do contrato + prazos legais de retenção (item 7) |

2.1. A definição da base legal aplicável a cada operação é de responsabilidade da CONTROLADORA. A CONTRATADA fornece os meios técnicos de registro de consentimento e de revogação.

## 3. Obrigações da CONTRATADA

3.1. Tratar os dados apenas conforme instruções documentadas da CONTROLADORA, informando-a caso entenda que uma instrução viola a LGPD.

3.2. Garantir que todo pessoal com acesso a dados esteja sujeito a **dever de confidencialidade** por escrito.

3.3. Implementar e manter as medidas técnicas do **item 5**, com revisão ao menos anual.

3.4. Auxiliar a CONTROLADORA, na medida do tecnicamente possível, no atendimento a:
- requisições de titulares (art. 18: acesso, correção, portabilidade, eliminação, informação sobre compartilhamento);
- solicitações da ANPD;
- relatórios de impacto (RIPD), quando exigidos.

3.5. Não subcontratar novo operador sem **autorização prévia e por escrito** da CONTROLADORA (item 6).

## 4. Incidentes de segurança

4.1. A CONTRATADA notificará a CONTROLADORA sobre incidente de segurança envolvendo dados pessoais em prazo **não superior a 24 (vinte e quatro) horas** contadas do conhecimento do fato.

4.2. A notificação conterá, na medida do disponível: natureza do incidente, categorias e número aproximado de titulares afetados, consequências prováveis, medidas adotadas ou propostas.

4.3. A comunicação à ANPD e aos titulares (art. 48) é atribuição da CONTROLADORA, com apoio técnico da CONTRATADA.

4.4. A CONTRATADA manterá registro interno de incidentes, disponível à CONTROLADORA mediante solicitação.

## 5. Medidas técnicas e organizacionais

Implementadas e verificáveis no código-fonte:

| Controle | Implementação |
|---|---|
| **Isolamento entre clínicas** | Row Level Security FORCE no PostgreSQL: cada clínica só acessa as próprias linhas. Roles da aplicação são `NOSUPERUSER NOBYPASSRLS`. Modo de falha é *fail-closed* (sem identificação de tenant, retorna zero registros) |
| **Controle de acesso por papel** | Perfis `recepcao`, `medico`, `admin`. Recepção **não** acessa texto clínico de prontuário |
| **Autenticação** | Senhas com bcrypt (fator 12); sessão em cookie `httpOnly`, `secure`, `sameSite`; expiração em 8h; bloqueio progressivo após tentativas falhas |
| **Criptografia em trânsito** | HTTPS obrigatório (HSTS); conexão ao banco em TLS com **verificação de certificado** |
| **Criptografia em repouso** | Provida pelo provedor de banco gerenciado (AES-256) |
| **Integrações automatizadas** | Chamadas do agente de atendimento autenticadas por HMAC-SHA256 com proteção contra replay; identificação da clínica derivada da credencial, nunca do conteúdo da requisição |
| **Prevenção de injeção** | Consultas exclusivamente parametrizadas (*prepared statements*); privilégio mínimo por role |
| **Registro de operações** | Trilha de auditoria de acessos e alterações, consultável por perfil administrador |
| **Segregação de ambientes** | Produção separada de desenvolvimento; sem dados reais de paciente em ambiente de teste |
| **Backup** | Cópia diária com restauração testada periodicamente |

5.1. **Limitações declaradas.** A CONTRATADA informa expressamente que:

(a) O texto clínico **não** é criptografado em nível de campo. Fica protegido por controle de acesso e criptografia em repouso, mas é legível por administrador de banco de dados. Risco aceito e registrado no ROPA.

(b) O canal de WhatsApp identifica o paciente pelo **número de telefone**, sem autenticação forte. A CONTRATADA aplica confirmação adicional de identidade antes de revelar informação de agendamento e **não** transmite conteúdo clínico por esse canal. A CONTROLADORA reconhece que número reciclado ou aparelho de terceiro constituem risco residual inerente ao canal.

(c) O canal de WhatsApp opera por plataforma de terceiro sujeita a indisponibilidade ou bloqueio alheios ao controle da CONTRATADA.

## 6. Subprocessadores

6.1. A CONTROLADORA autoriza os subprocessadores listados em **[`subprocessadores.md`](./subprocessadores.md)**, que integra este anexo.

6.2. Alteração da lista será comunicada com **30 dias** de antecedência, cabendo à CONTROLADORA opor-se motivadamente; a oposição não sanada faculta a rescisão sem ônus.

6.3. **Transferência internacional.** Parte dos subprocessadores está fora do Brasil. As transferências fundam-se no art. 33 da LGPD e em cláusulas contratuais dos respectivos fornecedores. Detalhamento por fornecedor no documento do item 6.1.

## 7. Retenção e eliminação

7.1. Prontuário: retido pelo prazo da regulamentação aplicável ao exercício profissional (**mínimo 20 anos** contados do último registro, conforme normas do Conselho Federal de Medicina), prevalecendo sobre pedido de eliminação (art. 16, I).

7.2. Dados fiscais e financeiros: retidos conforme legislação tributária.

7.3. Registros de tentativa de login: 30 dias.

7.4. Demais dados: eliminados ou anonimizados em até **90 dias** após o término do contrato, salvo obrigação legal de guarda.

7.5. **Na rescisão**, a CONTRATADA fornecerá, em até **15 dias** e sem custo adicional, a integralidade dos dados da CONTROLADORA em formato aberto e interoperável (CSV ou dump SQL). A eliminação ocorre após confirmação de recebimento.

## 8. Auditoria

8.1. A CONTROLADORA poderá solicitar, uma vez por ano, comprovação documental das medidas do item 5.

8.2. Auditoria presencial ou teste de intrusão por terceiro requer aviso de 30 dias, acordo de confidencialidade e correm por conta da CONTROLADORA.

## 9. Responsabilidade

9.1. Cada parte responde pelos danos decorrentes do descumprimento de suas próprias obrigações, nos termos dos arts. 42 a 45 da LGPD.

9.2. São de responsabilidade exclusiva da CONTROLADORA: a licitude da base legal de cada tratamento; a obtenção e a guarda do consentimento para comunicações de reativação; a exatidão dos dados fornecidos; e a gestão de contas e perfis de seus usuários, incluindo o desligamento tempestivo de colaboradores.

9.3. A CONTRATADA não responde por incidente decorrente de credencial de usuário da CONTROLADORA comprometida por culpa desta.

---

**Referências técnicas** (verificáveis no repositório): `src/lib/tenant.ts` (isolamento), `src/lib/rbac.ts` (perfis), `src/lib/session.ts` e `src/lib/auth.ts` (autenticação), `src/lib/hmac.ts` (integrações), `src/lib/db.ts` (TLS), `next.config.ts` (headers), `.planning/seguranca/002-contract-test.sql` (prova automatizada do isolamento).

**Revisão jurídica:** ______________________  **Data:** ____/____/______
