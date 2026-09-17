# Brief de Pesquisa — Módulo Financeiro (AIOS.clinic)

> Preencher com ajuda de pesquisa (IA/web). Contexto: SaaS para **clínicas no Brasil**
> (odontológica/estética/saúde de pequeno porte). Stack: Next 16 + Postgres. Já existem
> módulos Atendimento (WhatsApp IA), Prontuário e Estoque. O Financeiro vai gerar cobrança
> automática ao finalizar o atendimento. Responder de forma objetiva; citar fonte quando der.

---

## BLOCO A — Pagamento (decisão D3: registro manual vs gateway real)

A1. Quais formas de pagamento as clínicas BR de pequeno porte mais usam hoje?
    (Pix, cartão débito/crédito na maquininha, dinheiro, boleto, link de pagamento) — ranking aproximado.
A2. Se for usar gateway, **qual PSP** é mais comum/recomendado para clínicas BR?
    (Mercado Pago, Asaas, Pagar.me, Stripe, Gerencianet/Efí, PagBank…) — prós/contras de cada p/ Pix + boleto + cartão.
A3. **Pix via API**: como funciona o fluxo mínimo (cob dinâmica → QR/copia-e-cola → webhook de confirmação)?
    Precisa de chave Pix da clínica? Precisa de certificado (mTLS)? Tem custo por transação?
A4. Taxas típicas por forma (Pix, boleto, cartão) nos PSPs do A2.
A5. Confiabilidade do **webhook de confirmação** (idempotência, reentrega, validação de assinatura) — boas práticas.
A6. Conciliação: como o mercado trata divergência (pago a maior/menor, estorno, chargeback)?
A7. Veredito recomendado: **registro manual (v1) e gateway depois**, ou **gateway já na v1**? Por quê?
    > Resposta esperada: escolha + 2-3 bullets de justificativa + qual PSP se for gateway.

## BLOCO B — Preço / tabela (decisão D4)

B1. Clínicas trabalham com **tabela de preço fixa por procedimento**, por convênio, ou orçamento caso a caso?
B2. Faixas de preço de referência por tipo (consulta, retorno, procedimento, avaliação, limpeza) — só ordem de grandeza.
B3. **Convênios**: a clínica recebe do convênio (não do paciente) em parte dos casos? Isso muda o recebível?
    (já existe coluna `clinicas.convenios` text no banco — como costuma ser usada?)
B4. Preço varia por profissional? Há repasse/comissão por profissional? (impacta margem)
    > Resposta esperada: tabela vs manual + se precisa modelar convênio/comissão na v1 ou v2.

## BLOCO C — Cobrança / recebíveis

C1. Quando a cobrança "nasce" na prática: no agendamento, no atendimento, ou na alta? (valida o hook na finalização)
C2. **Vencimento**: paga na hora (à vista no balcão) é o normal, ou tem prazo (ex.: 30 dias)? Default sugerido?
C3. **Parcelamento** é comum? (ex.: tratamento ortodôntico em N parcelas) — precisa na v1 ou v2?
C4. Desconto / acréscimo / multa-juros por atraso — a clínica aplica? Como?
    > Resposta esperada: default de vencimento + se parcelamento/multa entram na v1 ou v2.

## BLOCO D — Inadimplência

D1. Práticas comuns de cobrança de inadimplente em clínica (régua: quantos dias, quantos toques, canal).
D2. É aceitável/legal **cobrar inadimplência por WhatsApp**? Cuidados (LGPD, não expor diagnóstico/valor a terceiros)?
D3. O que entra num "aviso de vencimento" sem violar privacidade? (texto-modelo aceitável)
    > Resposta esperada: régua sugerida + do/don't de LGPD na cobrança por mensagem.

## BLOCO E — Fiscal / legal (Brasil)

E1. Clínica precisa emitir **NFS-e** (nota fiscal de serviço) por atendimento? É municipal — como costuma ser integrado?
E2. **Recibo** ao paciente é exigido/esperado? Conteúdo mínimo?
E3. Dados financeiros do paciente sob **LGPD**: base legal, retenção, quem pode ver. Restrições relevantes ao modelo.
E4. Há obrigação de **livro-caixa**/relatório contábil que o módulo deveria espelhar?
    > Resposta esperada: NFS-e entra na v1/v2/nunca + requisitos mínimos de recibo + flags LGPD.

## BLOCO F — Caixa / relatórios (expectativa do gestor)

F1. Quais números o dono de clínica quer ver primeiro? (caixa do dia/mês, a receber, inadimplência, ticket médio, margem…)
F2. **Margem por procedimento** (receita − custo de material) é útil/entendível pra esse público? Como apresentar?
F3. Categorias de despesa típicas (aluguel, salários, material, impostos…) — vale uma lista padrão?
F4. Período padrão dos relatórios (dia, mês, competência vs caixa).
    > Resposta esperada: top 4-5 indicadores priorizados + lista de categorias de despesa.

## BLOCO G — Integração / restrições técnicas

G1. Se gateway: o PSP exige domínio/HTTPS público p/ webhook (temos Railway) e há sandbox p/ testar sem dinheiro real?
G2. Limite de valor/precisão (centavos), moeda (BRL), arredondamento — convenções.
G3. Algum sistema financeiro/contábil que clínicas já usam e que poderíamos exportar/integrar (CSV, OFX)?
    > Resposta esperada: requisitos de webhook/sandbox + formato de export desejável (se houver).

---

## Resumo que eu preciso de volta (mínimo para destravar a Fase 1)

1. **D3** → manual ou gateway? Se gateway, **qual PSP** e se Pix-API cabe na v1.
2. **D4** → tabela de preço por tipo (+override) ou sempre manual? Convênio/comissão na v1?
3. **Vencimento default** e se **parcelamento** entra na v1.
4. **NFS-e/recibo** entra na v1, v2 ou fora de escopo.
5. **Top indicadores** que o painel deve mostrar primeiro.
6. **Do/don't de LGPD** para cobrança/mensagem.

(O resto é "nice to know" e refina o design, mas não bloqueia.)
