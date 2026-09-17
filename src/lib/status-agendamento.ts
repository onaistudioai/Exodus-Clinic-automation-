/**
 * Fonte ÚNICA dos status de agendamento no TypeScript.
 *
 * POR QUE ISTO EXISTE: a união vivia escrita à mão em types/domain.ts e ficou
 * defasada do banco — `bot-agendamento/001` trocou o CHECK (saíram 'pendente' e
 * 'remarcacao_pendente', entraram 'reservada'/'agendada'/'expirada') e a camada-a
 * acrescentou mais três. O `Record<StatusAgendamento, …>` da Agenda passou a
 * devolver `undefined` para status reais, quebrando a linha na leitura.
 *
 * O tipo agora DERIVA da lista: quem acrescentar um status aqui é obrigado pelo
 * compilador a preencher todo `Record` que usa o tipo. E tests/schema-contract
 * compara esta lista com o CHECK do banco, fechando a outra direção.
 *
 * Espelha chk_status_agendamento (.planning/camada-a/sql/002-estados-e-payload.sql).
 */
export const STATUS_AGENDAMENTO = [
  "reservada",
  "agendada",
  "confirmada",
  "cancelada",
  "remarcada",
  "realizada",
  "no_show",
  "expirada",
  "recusada",
  "sem_resposta",
  "escalado_humano",
] as const;

export type StatusAgendamento = (typeof STATUS_AGENDAMENTO)[number];

/** Aceita a string crua do banco sem afirmar o tipo às cegas. */
export function eStatusConhecido(s: string): s is StatusAgendamento {
  return (STATUS_AGENDAMENTO as readonly string[]).includes(s);
}

/**
 * Rótulos da UI. Ficam AQUI, ao lado da lista, e não no componente: assim o
 * compilador exige entrada para todo status novo no mesmo arquivo em que ele foi
 * acrescentado — o erro chega antes de alguém abrir a Agenda. (Também torna o
 * mapa importável por teste: `.tsx` não carrega fora do bundler do Next.)
 */
export const STATUS_ROTULO: Record<StatusAgendamento, { txt: string; cls: string }> = {
  reservada: { txt: "Reservada", cls: "bg-neutral-100 text-neutral-600" },
  agendada: { txt: "Agendada", cls: "bg-neutral-100 text-neutral-600" },
  confirmada: { txt: "Confirmada", cls: "bg-sky-50 text-sky-700" },
  remarcada: { txt: "Remarcada", cls: "bg-amber-50 text-amber-700" },
  realizada: { txt: "Realizada", cls: "bg-emerald-50 text-emerald-700" },
  no_show: { txt: "No-show", cls: "bg-red-50 text-red-700" },
  expirada: { txt: "Expirada", cls: "bg-neutral-100 text-neutral-400" },
  recusada: { txt: "Recusada", cls: "bg-red-50 text-red-700" },
  sem_resposta: { txt: "Sem resposta", cls: "bg-amber-50 text-amber-700" },
  escalado_humano: { txt: "Com a equipe", cls: "bg-violet-50 text-violet-700" },
  cancelada: { txt: "Cancelada", cls: "bg-neutral-100 text-neutral-400 line-through" },
};

/** Fallback: o teste impede a divergência, isto impede o crash se ela escapar. */
export const STATUS_DESCONHECIDO = { txt: "—", cls: "bg-neutral-100 text-neutral-500" };
