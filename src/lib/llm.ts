import "server-only";

/**
 * Cliente do modelo. `fetch` e nada mais.
 *
 * POR QUE NENHUMA BIBLIOTECA: a API do Groq é HTTP e fala o formato de mensagens
 * da OpenAI, que é o mesmo que praticamente todo provedor aceita hoje. O que um
 * SDK acrescentaria aqui — tipos, retry, o laço de tool-calling — são as ~80
 * linhas abaixo. Um pacote a mais no bundle do painel é uma superfície a mais
 * para auditar num sistema que carrega dado de saúde.
 *
 * MODELO: era llama-3.3-70b-versatile, DESCONTINUADO pela Groq — devolvia 404
 * em toda chamada (achado em 2026-09-03 rodando a camada 3). Trocado por
 * openai/gpt-oss-120b, validado nos 25 casos-âncora de trajetória.
 * ATENÇÃO: os workflows da SOFIA no n8n (sofia-demo/n8n/*.json) ainda apontam
 * para o modelo morto. O n8n está fora do ar desde 2026-07-27, então não
 * quebra nada hoje — mas quando voltar precisa receber ESTE mesmo modelo.
 * Dois modelos diferentes respondendo pela mesma clínica seria a divergência
 * de sempre, agora em comportamento em vez de em lista.
 */

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODELO = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

export interface Mensagem {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ChamadaFerramenta[];
  tool_call_id?: string;
}

export interface ChamadaFerramenta {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface FerramentaExposta {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string | string[]; description: string }>;
      required: string[];
    };
  };
}

export interface RespostaLLM {
  content: string | null;
  tool_calls: ChamadaFerramenta[];
}

export async function chamarLLM(
  mensagens: Mensagem[],
  ferramentas: FerramentaExposta[]
): Promise<RespostaLLM> {
  const chave = process.env.GROQ_API_KEY;
  if (!chave) throw new Error("GROQ_API_KEY ausente no ambiente.");

  // Timeout explícito: sem ele, um provedor lento segura o request do painel
  // até o timeout do runtime, que é bem mais longo do que qualquer pessoa espera.
  const abort = AbortSignal.timeout(30_000);

  const resposta = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${chave}`,
    },
    body: JSON.stringify({
      model: MODELO,
      messages: mensagens,
      // `tools: []` faz alguns provedores recusarem o request. Papel sem
      // nenhuma ferramenta é caso real (papel só de leitura sem módulos), então
      // o campo some em vez de ir vazio.
      ...(ferramentas.length > 0 ? { tools: ferramentas, tool_choice: "auto" } : {}),
      temperature: 0.2,
    }),
    signal: abort,
  });

  if (!resposta.ok) {
    // O corpo do erro pode conter o prompt inteiro de volta; não vai para o log.
    throw new Error(`Provedor do modelo respondeu ${resposta.status}.`);
  }

  const dados = (await resposta.json()) as {
    choices: { message: { content: string | null; tool_calls?: ChamadaFerramenta[] } }[];
  };
  const msg = dados.choices[0]?.message;
  return { content: msg?.content ?? null, tool_calls: msg?.tool_calls ?? [] };
}
