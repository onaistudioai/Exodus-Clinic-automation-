#!/usr/bin/env node
/**
 * Semeia o cenário de demonstração "A CADEIRA VAZIA" numa clínica já
 * provisionada.
 *
 * Pré-requisito: a clínica tem de existir. Rode antes:
 *   node scripts/provisionar-clinica.mjs --nome "[DEMO] Clínica Aurora" \
 *        --slug demo-aurora --admin-email demo@aurora.local --admin-nome "Admin Aurora"
 *
 * Uso: node scripts/seed-demo-cadeira-vazia.mjs --slug demo-aurora [--limpar]
 *
 * ---------------------------------------------------------------------------
 * O CENÁRIO (é uma cadeia, não um passeio por funcionalidades)
 *
 * Dois cancelamentos de última hora abriram dois buracos na agenda desta
 * semana. Isso não é um problema de agenda — é o começo de quatro:
 *
 *   1. AGENDA     buraco de 60 min na quinta 14:00 (aplicação de toxina) e
 *                 de 40 min na sexta 10:00 (consulta).
 *   2. ESTOQUE    o lote de toxina vence em ~20 dias e SÓ é consumido por
 *                 esse procedimento. Cadeira vazia aqui = produto no lixo.
 *   3. AGENDA(2)  há duas pessoas na lista de espera exatamente para esse
 *                 serviço. O encaixe existe; ninguém olhou.
 *   4. FINANCEIRO quem cancelou a quinta é justamente quem tem uma cobrança
 *                 vencida há 40 dias. Sumiço e inadimplência são o mesmo
 *                 evento visto de dois módulos.
 *
 * A pergunta que o assistente do painel (/chat) deve conseguir responder:
 * "o que vagou essa semana, e quem eu chamo para preencher?"
 *
 * DADO SINTÉTICO. Nomes, telefones e valores são inventados. Nada aqui é
 * pessoa real — a clínica inteira nasce marcada com [DEMO] no nome.
 * ---------------------------------------------------------------------------
 */
import fs from "node:fs";
import pg from "pg";

const CRED = "D:/projetos/.credentials/exodus/postgres.env";

function lerCredencial(chave) {
  const conteudo = fs.readFileSync(CRED, "utf-8");
  const m = conteudo.match(new RegExp(`^\\s*${chave}\\s*=\\s*['"]?([^'"\\r\\n]+)`, "m"));
  if (!m) throw new Error(`${chave} não encontrada em ${CRED}`);
  return m[1].trim();
}

function args() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const chave = argv[i].slice(2);
    out[chave] = argv[i + 1]?.startsWith("--") || argv[i + 1] === undefined ? true : argv[++i];
  }
  return out;
}

// --- datas relativas a hoje, para o cenário não envelhecer ------------------
const HOJE = new Date();
HOJE.setHours(0, 0, 0, 0);
const dia = (n) => {
  const d = new Date(HOJE);
  d.setDate(d.getDate() + n);
  return d;
};
const iso = (d) => d.toISOString().slice(0, 10);
/** timestamptz no fuso da clínica (America/Sao_Paulo = UTC-3, sem horário de verão desde 2019). */
const ts = (d, hhmm) => `${iso(d)} ${hhmm}:00-03`;

/** Próxima ocorrência de um dia da semana (1=seg … 5=sex), a partir de amanhã. */
function proximo(diaSemana) {
  for (let i = 1; i <= 7; i++) {
    const d = dia(i);
    if (d.getDay() === diaSemana) return d;
  }
  return dia(1);
}

async function main() {
  const a = args();
  const slug = typeof a.slug === "string" ? a.slug : "demo-aurora";

  const client = new pg.Client({ connectionString: lerCredencial("DATABASE_URL_OWNER_BR") });
  await client.connect();
  const q = (sql, params) => client.query(sql, params);
  const um = async (sql, params) => (await q(sql, params)).rows[0];

  try {
    const clinica = await um(`SELECT id, nome FROM clinicas WHERE slug = $1`, [slug]);
    if (!clinica) {
      throw new Error(
        `clínica com slug "${slug}" não existe. Rode antes:\n` +
          `  node scripts/provisionar-clinica.mjs --nome "[DEMO] Clínica Aurora" --slug ${slug} \\\n` +
          `       --admin-email demo@aurora.local --admin-nome "Admin Aurora"`
      );
    }
    const C = clinica.id;

    const jaTem = await um(`SELECT count(*)::int n FROM servicos WHERE clinica_id = $1`, [C]);
    if (jaTem.n > 0 && !a.limpar) {
      console.log(
        `\nclínica #${C} ${clinica.nome} já tem dados semeados (${jaTem.n} serviços).\n` +
          `Nada foi alterado. Este script NÃO é idempotente por linha — semear de novo\n` +
          `duplicaria agenda e cobranças, e o schema é append-only (sem DELETE).\n` +
          `Para uma demo limpa, provisione outra clínica com outro slug.\n`
      );
      return;
    }

    await q("BEGIN");
    // Owner tem BYPASSRLS, mas os INSERTs abaixo usam clinica_id explícito —
    // e o GUC fica setado para o caso de alguma trigger/função depender dele.
    await q(`SELECT set_config('app.clinica_id', $1, true)`, [String(C)]);

    const adm = await um(
      `SELECT id FROM usuarios WHERE clinica_id = $1 AND papel = 'admin' ORDER BY id LIMIT 1`,
      [C]
    );
    const USUARIO = adm?.id ?? null;

    // ---------------------------------------------------------------- equipe
    const prof = {};
    for (const [chave, nome, esp] of [
      ["helena", "Dra. Helena Braga", "Dermatologia"],
      ["rafael", "Dr. Rafael Nunes", "Clínica geral"],
    ]) {
      const r = await um(
        `INSERT INTO profissionais (clinica_id, nome, especialidade, ativo)
              VALUES ($1,$2,$3,true) RETURNING id`,
        [C, nome, esp]
      );
      prof[chave] = r.id;
    }

    const serv = {};
    for (const [chave, nome, min] of [
      ["avaliacao", "Avaliação inicial", 30],
      ["consulta", "Consulta", 40],
      ["retorno", "Retorno", 20],
      ["toxina", "Aplicação de toxina botulínica", 60],
    ]) {
      const r = await um(
        `INSERT INTO servicos (clinica_id, nome, duracao_min, ativo)
              VALUES ($1,$2,$3,true) RETURNING id`,
        [C, nome, min]
      );
      serv[chave] = r.id;
    }

    // Turnos seg-sex. Helena de manhã e tarde; Rafael só de manhã — é o que
    // torna a tarde da quinta um buraco difícil de preencher.
    for (let d = 1; d <= 5; d++) {
      await q(
        `INSERT INTO turnos (clinica_id, profissional_id, dia_semana, hora_inicio, hora_fim)
              VALUES ($1,$2,$3,'09:00','12:00'), ($1,$2,$3,'13:00','18:00')`,
        [C, prof.helena, d]
      );
      await q(
        `INSERT INTO turnos (clinica_id, profissional_id, dia_semana, hora_inicio, hora_fim)
              VALUES ($1,$2,$3,'09:00','12:00')`,
        [C, prof.rafael, d]
      );
    }

    // ---------------------------------------------------------------- preços
    for (const [tipo, valor] of [
      ["avaliacao", 180],
      ["consulta", 320],
      ["retorno", 150],
      ["procedimento", 1200],
      ["limpeza", 250],
    ]) {
      await q(
        `INSERT INTO financeiro_precos (clinica_id, tipo_atendimento, valor, ativo)
              VALUES ($1,$2,$3,true)`,
        [C, tipo, valor]
      );
    }

    // ------------------------------------------------------------- pacientes
    const PACIENTES = [
      ["Marina Alencar", "1988-03-12", "11970001001"],
      ["Beatriz Fonseca", "1979-11-02", "11970001002"],
      ["Carlos Tavares", "1965-06-25", "11970001003"],
      ["Daniela Rocha", "1992-01-18", "11970001004"],
      ["Eduardo Lima", "1984-09-07", "11970001005"],
      ["Fernanda Prado", "1996-04-30", "11970001006"],
      ["Gustavo Mendes", "1971-12-14", "11970001007"],
      ["Helena Vasques", "1990-08-21", "11970001008"],
      ["Igor Salgado", "1983-02-09", "11970001009"],
      ["Juliana Terra", "1975-05-16", "11970001010"],
      ["Karina Doria", "1998-10-03", "11970001011"],
      ["Lucas Andrade", "1969-07-28", "11970001012"],
    ];
    const pac = {};
    const contato = {};
    for (const [nome, nasc, tel] of PACIENTES) {
      const p = await um(
        `INSERT INTO pacientes (clinica_id, nome_completo, data_nascimento, status, criado_por)
              VALUES ($1,$2,$3,'ativo',$4) RETURNING id`,
        [C, nome, nasc, USUARIO]
      );
      pac[nome.split(" ")[0]] = p.id;

      const ct = await um(
        `INSERT INTO contatos_whatsapp
                (clinica_id, chat_id, telefone, status, verificado_em, marketing_optin, origem, estado_lead)
              VALUES ($1,$2,$3,'ativo',now(),true,'organico','convertido') RETURNING id`,
        [C, `55${tel}@c.us`, tel]
      );
      contato[nome.split(" ")[0]] = ct.id;

      // `titular` (boolean) E `papel` (enum) — as duas colunas. Só a booleana
      // deixaria vinculoTitularDoPaciente() sem enxergar o vínculo, porque ela
      // filtra por pc.papel = 'titular'.
      await q(
        `INSERT INTO paciente_contato
                (clinica_id, paciente_id, contato_id, titular, papel, nivel, vinculo_status)
              VALUES ($1,$2,$3,true,'titular','agendar_e_consultar','ativo')`,
        [C, p.id, ct.id]
      );
    }

    // --------------------------------------------------------------- estoque
    const prodToxina = await um(
      `INSERT INTO produtos (clinica_id, nome, categoria, unidade, estoque_minimo, controlado, ativo)
            VALUES ($1,'Toxina botulínica 100U','injetavel','frasco',2,true,true) RETURNING id`,
      [C]
    );
    const prodAcido = await um(
      `INSERT INTO produtos (clinica_id, nome, categoria, unidade, estoque_minimo, controlado, ativo)
            VALUES ($1,'Ácido hialurônico 1ml','injetavel','seringa',5,true,true) RETURNING id`,
      [C]
    );
    const prodLuva = await um(
      `INSERT INTO produtos (clinica_id, nome, categoria, unidade, estoque_minimo, controlado, ativo)
            VALUES ($1,'Luva de procedimento M','descartavel','caixa',4,false,true) RETURNING id`,
      [C]
    );

    // O lote que vence em 20 dias — o coração do cenário.
    const loteVencendo = await um(
      `INSERT INTO lotes (clinica_id, produto_id, codigo_lote, validade, quantidade, custo_unitario)
            VALUES ($1,$2,'TXB-2291',$3,6,540) RETURNING id`,
      [C, prodToxina.id, iso(dia(20))]
    );
    await q(
      `INSERT INTO lotes (clinica_id, produto_id, codigo_lote, validade, quantidade, custo_unitario)
            VALUES ($1,$2,'TXB-2304',$3,4,540)`,
      [C, prodToxina.id, iso(dia(210))]
    );
    // Ácido abaixo do mínimo (5): só 2 seringas.
    await q(
      `INSERT INTO lotes (clinica_id, produto_id, codigo_lote, validade, quantidade, custo_unitario)
            VALUES ($1,$2,'AH-8812',$3,2,310)`,
      [C, prodAcido.id, iso(dia(160))]
    );
    await q(
      `INSERT INTO lotes (clinica_id, produto_id, codigo_lote, validade, quantidade, custo_unitario)
            VALUES ($1,$2,'LUV-4410',$3,12,38)`,
      [C, prodLuva.id, iso(dia(400))]
    );
    await q(
      `INSERT INTO movimentacoes_estoque
              (clinica_id, produto_id, lote_id, tipo, motivo, quantidade, custo_unitario, usuario_id)
            VALUES ($1,$2,$3,'entrada','compra',6,540,$4)`,
      [C, prodToxina.id, loteVencendo.id, USUARIO]
    );

    // A ligação que fecha a cadeia: 'procedimento' consome a toxina. Sem esta
    // linha, ninguém consegue responder "que produto essa cadeira vazia perde".
    await q(
      `INSERT INTO procedimento_materiais (clinica_id, tipo_atendimento, produto_id, quantidade)
            VALUES ($1,'procedimento',$2,1), ($1,'consulta',$3,0.5)`,
      [C, prodToxina.id, prodLuva.id]
    );

    // ----------------------------------------------------------------- agenda
    const quinta = proximo(4);
    const sexta = proximo(5);

    const agendar = async (o) => {
      const r = await um(
        `INSERT INTO agendamentos_sofia_demo
                (clinica_id, paciente_id, profissional_id, servico_id, telefone, chat_id,
                 data_agendamento, hora_agendamento, inicio, fim, status)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,
                      $9::timestamptz + ($10 || ' minutes')::interval,$11)
           RETURNING id`,
        [
          C, o.paciente, o.profissional, o.servico, o.telefone, `55${o.telefone}@c.us`,
          iso(o.dia), o.hora, ts(o.dia, o.hora), String(o.duracao), o.status,
        ]
      );
      return r.id;
    };

    const tel = (nome) => PACIENTES.find((p) => p[0].startsWith(nome))?.[2] ?? "11970000000";

    // Passado: atendimentos realizados, que geram o caixa do mês.
    const realizados = [
      ["Marina", prof.helena, serv.consulta, 40, -21, "09:00"],
      ["Beatriz", prof.helena, serv.toxina, 60, -18, "14:00"],
      ["Carlos", prof.rafael, serv.consulta, 40, -14, "10:00"],
      ["Daniela", prof.helena, serv.retorno, 20, -11, "09:30"],
      ["Eduardo", prof.rafael, serv.avaliacao, 30, -8, "11:00"],
      ["Fernanda", prof.helena, serv.toxina, 60, -6, "15:00"],
      ["Gustavo", prof.rafael, serv.consulta, 40, -4, "09:00"],
    ];
    for (const [nome, p, s, dur, off, hora] of realizados) {
      await agendar({
        paciente: pac[nome], profissional: p, servico: s, duracao: dur,
        dia: dia(off), hora, telefone: tel(nome), status: "realizada",
      });
    }

    // Hoje: a agenda em andamento.
    await agendar({ paciente: pac.Helena, profissional: prof.rafael, servico: serv.consulta, duracao: 40, dia: HOJE, hora: "09:00", telefone: tel("Helena"), status: "confirmada" });
    await agendar({ paciente: pac.Igor, profissional: prof.helena, servico: serv.avaliacao, duracao: 30, dia: HOJE, hora: "10:00", telefone: tel("Igor"), status: "confirmada" });
    await agendar({ paciente: pac.Juliana, profissional: prof.helena, servico: serv.retorno, duracao: 20, dia: HOJE, hora: "14:00", telefone: tel("Juliana"), status: "agendada" });

    // OS DOIS BURACOS. Cancelados ontem, ninguém preencheu.
    const cancQuinta = await agendar({
      paciente: pac.Beatriz, profissional: prof.helena, servico: serv.toxina, duracao: 60,
      dia: quinta, hora: "14:00", telefone: tel("Beatriz"), status: "cancelada",
    });
    const cancSexta = await agendar({
      paciente: pac.Carlos, profissional: prof.rafael, servico: serv.consulta, duracao: 40,
      dia: sexta, hora: "10:00", telefone: tel("Carlos"), status: "cancelada",
    });
    for (const id of [cancQuinta, cancSexta]) {
      await q(
        `INSERT INTO eventos_agendamento (clinica_id, agendamento_id, tipo, origem, ator, ocorrido_em)
              VALUES ($1,$2,'cancelado','bot','cancelamento por WhatsApp, D-1', now() - interval '1 day')`,
        [C, id]
      );
    }

    // Resto da semana, para os buracos aparecerem como buracos e não como
    // "agenda vazia".
    await agendar({ paciente: pac.Karina, profissional: prof.helena, servico: serv.toxina, duracao: 60, dia: quinta, hora: "15:30", telefone: tel("Karina"), status: "confirmada" });
    await agendar({ paciente: pac.Lucas, profissional: prof.rafael, servico: serv.consulta, duracao: 40, dia: quinta, hora: "09:00", telefone: tel("Lucas"), status: "confirmada" });
    await agendar({ paciente: pac.Marina, profissional: prof.helena, servico: serv.retorno, duracao: 20, dia: sexta, hora: "09:00", telefone: tel("Marina"), status: "agendada" });
    await agendar({ paciente: pac.Daniela, profissional: prof.helena, servico: serv.consulta, duracao: 40, dia: sexta, hora: "14:00", telefone: tel("Daniela"), status: "agendada" });

    // ------------------------------------------------------- lista de espera
    // O encaixe que existe e ninguém viu.
    await q(
      `INSERT INTO lista_espera (clinica_id, paciente_id, servico_id, profissional_id, disponibilidade, ativo, expira_em)
            VALUES ($1,$2,$3,$4,'tarde',true,$6), ($1,$5,$3,NULL,'qualquer',true,$6)`,
      [C, pac.Fernanda, serv.toxina, prof.helena, pac.Gustavo, iso(dia(45))]
    );

    // ------------------------------------------------------------ financeiro
    const cobranca = async (o) => {
      await q(
        `INSERT INTO financeiro_cobrancas
                (clinica_id, paciente_id, tipo_atendimento, valor, vencimento, status,
                 forma_pagamento, pago_em)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [C, o.paciente, o.tipo, o.valor, iso(dia(o.venc)), o.status,
         o.forma ?? null, o.status === "paga" ? ts(dia(o.venc), "12:00") : null]
      );
    };
    // Pagas — o caixa do mês.
    await cobranca({ paciente: pac.Marina, tipo: "consulta", valor: 320, venc: -21, status: "paga", forma: "pix" });
    await cobranca({ paciente: pac.Daniela, tipo: "retorno", valor: 150, venc: -11, status: "paga", forma: "cartao" });
    await cobranca({ paciente: pac.Eduardo, tipo: "avaliacao", valor: 180, venc: -8, status: "paga", forma: "pix" });
    await cobranca({ paciente: pac.Fernanda, tipo: "procedimento", valor: 1200, venc: -6, status: "paga", forma: "cartao" });
    await cobranca({ paciente: pac.Gustavo, tipo: "consulta", valor: 320, venc: -4, status: "paga", forma: "dinheiro" });
    // Vencidas — e a primeira é de quem cancelou a quinta.
    await cobranca({ paciente: pac.Beatriz, tipo: "procedimento", valor: 1200, venc: -40, status: "aberta" });
    await cobranca({ paciente: pac.Carlos, tipo: "consulta", valor: 320, venc: -25, status: "aberta" });
    await cobranca({ paciente: pac.Igor, tipo: "consulta", valor: 320, venc: -9, status: "aberta" });
    // Em aberto, ainda no prazo.
    await cobranca({ paciente: pac.Karina, tipo: "procedimento", valor: 1200, venc: 12, status: "aberta" });

    // ------------------------------------------------------------ reativação
    const camp = await um(
      `INSERT INTO reativacao_campanhas (clinica_id, nome, janela_dias, ativa)
            VALUES ($1,'Retorno 90 dias',90,true) RETURNING id`,
      [C]
    );
    const alvos = [
      ["Beatriz", "ativo", 1],
      ["Carlos", "ativo", 2],
      ["Juliana", "reativado", 3],
      ["Lucas", "optout", 1],
      ["Igor", "ativo", 0],
    ];
    for (const [nome, status, passo] of alvos) {
      await q(
        `INSERT INTO reativacao_alvos
                (clinica_id, campanha_id, paciente_id, contato_id, passo_atual, proximo_envio, status, reativado_em)
              VALUES ($1,$2,$3,$4,$5, now() + interval '2 days', $6, $7)`,
        [C, camp.id, pac[nome], contato[nome], passo, status,
         status === "reativado" ? ts(dia(-3), "10:00") : null]
      );
    }

    // --------------------------------------------------------- escalonamentos
    await q(
      `INSERT INTO escalonamentos (clinica_id, contato_id, chat_id, gatilho, trecho, status, criado_em, prazo_em)
            VALUES ($1,$2,$3,'sintoma_clinico','está ardendo e inchou depois da aplicação, é normal?','aberto',
                    now() - interval '5 hours', now() - interval '1 hour')`,
      [C, contato.Fernanda, `55${tel("Fernanda")}@c.us`]
    );
    await q(
      `INSERT INTO escalonamentos (clinica_id, contato_id, chat_id, gatilho, trecho, status, criado_em, prazo_em)
            VALUES ($1,$2,$3,'pediu_humano','prefiro falar com alguém da recepção','aberto',
                    now() - interval '40 minutes', now() + interval '3 hours')`,
      [C, contato.Carlos, `55${tel("Carlos")}@c.us`]
    );

    // ------------------------------------------------------------------- CRM
    await q(
      `INSERT INTO crm_tarefas (clinica_id, paciente_id, titulo, descricao, vencimento, status, criado_por)
            VALUES ($1,$2,'Cobrar retorno da Beatriz','Cancelou a aplicação de quinta e tem cobrança vencida há 40 dias.',$5,'aberta',$6),
                   ($1,$3,'Confirmar consulta do Carlos','Cancelou sexta 10h. Verificar se quer remarcar.',$5,'aberta',$6),
                   ($1,$4,'Follow-up pós-procedimento','Fernanda relatou ardência — checar evolução.',$5,'aberta',$6)`,
      [C, pac.Beatriz, pac.Carlos, pac.Fernanda, iso(dia(3)), USUARIO]
    );

    // -------------------------------------------- rastros do bot (histórico)
    // A SOFIA está fora do ar (n8n morto desde 27/07). Estas linhas são o que
    // ela TERIA deixado — servem para o painel contar a história inteira, não
    // para simular que o bot está rodando.
    const msg = async (nome, direcao, texto, horasAtras, intencao) => {
      await q(
        `INSERT INTO mensagens_bot (clinica_id, contato_id, direcao, conteudo, ocorrido_em, intencao)
              VALUES ($1,$2,$3,$4, now() - ($5 || ' hours')::interval, $6)`,
        [C, contato[nome], direcao, texto, String(horasAtras), intencao]
      );
    };
    await msg("Beatriz", "saida", "Oi Beatriz! Lembrete: sua aplicação está marcada para quinta às 14h.", 30, null);
    await msg("Beatriz", "entrada", "oi, não vou conseguir ir quinta, preciso cancelar", 28, "pedido_remarcacao");
    await msg("Beatriz", "saida", "Sem problema, cancelei sua quinta às 14h. Quer que eu veja outro horário?", 28, null);
    await msg("Carlos", "entrada", "consigo remarcar minha consulta de sexta?", 25, "pedido_remarcacao");
    await msg("Carlos", "entrada", "prefiro falar com alguém da recepção", 24, "ambigua");
    await msg("Fernanda", "entrada", "está ardendo e inchou depois da aplicação, é normal?", 5, "duvida_procedimento");

    await q("COMMIT");

    // ------------------------------------------------------------- resumo
    console.log(`\n  Cenário "A cadeira vazia" semeado em #${C} ${clinica.nome}\n`);
    console.log(`  ${PACIENTES.length} pacientes · 2 profissionais · 4 serviços · 3 produtos`);
    console.log(`  agenda: 7 realizadas, 3 hoje, 6 na semana`);
    console.log(`\n  Os dois buracos:`);
    console.log(`    ${iso(quinta)} 14:00 — Aplicação de toxina (Dra. Helena) — cancelada D-1`);
    console.log(`    ${iso(sexta)} 10:00 — Consulta (Dr. Rafael) — cancelada D-1`);
    console.log(`\n  A cadeia:`);
    console.log(`    lote TXB-2291 vence em ${iso(dia(20))} (6 frascos), consumido só por 'procedimento'`);
    console.log(`    2 pessoas na lista de espera para toxina`);
    console.log(`    R$ 1.840 vencidos em 3 cobranças — a maior é de quem cancelou a quinta`);
    console.log(`    2 escalonamentos abertos (1 com prazo estourado)`);
    // "próximos dias", NÃO "essa semana": proximo(quinta)/proximo(sexta) contam
    // a partir de amanhã, então semear numa sexta joga os dois buracos para a
    // semana seguinte. O modelo confere as datas recebidas contra a janela que
    // pediu e responde — corretamente — que nada vagou "essa semana"; quem
    // estaria errada é a pergunta, descrevendo um dado diferente do que este
    // script criou. Medido em 2026-09-05.
    console.log(
      `\n  Pergunte no /chat: "o que vagou nos próximos dias e quem eu chamo para preencher?"\n`
    );
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("seed-demo falhou:", e.message);
  process.exit(1);
});
