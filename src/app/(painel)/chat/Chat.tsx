"use client";

import { useState, useRef, useEffect } from "react";
import { PageHeader, Badge, Button, EmptyState } from "@/components/ui";

type Msg = { role: "user" | "assistant"; content: string };
type Capacidade = { descricao: string; escrita: boolean };

export default function Chat({
  papel,
  capacidades,
}: {
  papel: string;
  capacidades: Capacidade[];
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [texto, setTexto] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, carregando]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const pergunta = texto.trim();
    if (!pergunta || carregando) return;

    // Otimista: a pergunta aparece antes da resposta voltar. Se falhar, ela
    // continua na tela — reescrever o que a pessoa digitou é pior que o erro.
    const novo: Msg[] = [...msgs, { role: "user", content: pergunta }];
    setMsgs(novo);
    setTexto("");
    setErro(null);
    setCarregando(true);

    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensagens: novo }),
      });
      if (!r.ok) throw new Error("A assistente não respondeu. Tente de novo.");
      const dados = (await r.json()) as {
        resposta: string;
        pedidosCriados: { id: number; acao: string }[];
      };

      const extra =
        dados.pedidosCriados.length > 0
          ? `\n\n📋 Pedido(s) de aprovação criado(s): ${dados.pedidosCriados
              .map((p) => `#${p.id}`)
              .join(", ")}. Nada foi executado ainda.`
          : "";

      setMsgs([...novo, { role: "assistant", content: dados.resposta + extra }]);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha na conversa.");
    } finally {
      setCarregando(false);
    }
  }

  const leitura = capacidades.filter((c) => !c.escrita);
  const escrita = capacidades.filter((c) => c.escrita);

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <PageHeader
        title="Assistente"
        subtitle={`Você está como ${papel}. O que a assistente consegue fazer depende disso.`}
      />

      {msgs.length === 0 && (
        <div className="mb-6 space-y-3 rounded-xl border border-black/5 bg-white/60 p-4 text-sm">
          <p className="font-medium">Neste nível de acesso, você pode pedir para:</p>
          <ul className="space-y-1.5">
            {leitura.map((c) => (
              <li key={c.descricao} className="flex items-start gap-2">
                <Badge>consultar</Badge>
                <span className="text-neutral-700">{c.descricao}</span>
              </li>
            ))}
            {escrita.map((c) => (
              <li key={c.descricao} className="flex items-start gap-2">
                <Badge>alterar</Badge>
                <span className="text-neutral-700">{c.descricao}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-neutral-500">
            Ações que exigem autorização acima do seu papel viram um pedido de aprovação
            para o dono — nada é executado sem essa decisão.
          </p>
        </div>
      )}

      <div className="mb-4 space-y-4">
        {msgs.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-emerald-600 px-4 py-2.5 text-sm text-white"
                : "mr-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-neutral-100 px-4 py-2.5 text-sm text-neutral-900"
            }
          >
            {m.content}
          </div>
        ))}
        {carregando && (
          <div className="mr-auto rounded-2xl bg-neutral-100 px-4 py-2.5 text-sm text-neutral-500">
            consultando…
          </div>
        )}
        {erro && <EmptyState>{erro}</EmptyState>}
        <div ref={fim} />
      </div>

      <form onSubmit={enviar} className="sticky bottom-4 flex gap-2">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Pergunte sobre a clínica…"
          className="flex-1 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-emerald-500"
          disabled={carregando}
        />
        <Button type="submit" disabled={carregando || !texto.trim()}>
          Enviar
        </Button>
      </form>
    </div>
  );
}
