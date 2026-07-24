"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TIMEZONE } from "@/lib/timezone";

interface Conversa {
  id: string;
  telefone: string;
  estado: string;
  janelaAbertaAte: string | null;
  pacienteNome: string | null;
  ultimaMensagemEm: string;
  ultimaMensagem: { texto: string; direcao: string } | null;
}

interface Mensagem {
  id: string;
  direcao: string;
  texto: string;
  tipo: string;
  respondidaPorIa: boolean;
  criadoEm: string;
}

const POLL_MS = 15000;

function formatarHora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE });
}

function formatarDataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE,
  });
}

function estadoLabel(estado: string) {
  switch (estado) {
    case "aguardando_humano":
      return { texto: "Aguardando humano", classe: "bg-orange/10 text-orange" };
    case "fechada":
      return { texto: "Fechada", classe: "bg-muted/10 text-muted" };
    default:
      return { texto: "Aberta", classe: "bg-green/10 text-green" };
  }
}

function janelaAberta(conversa: Conversa | undefined) {
  if (!conversa?.janelaAbertaAte) return false;
  return new Date(conversa.janelaAbertaAte).getTime() > Date.now();
}

export default function WhatsappInboxPage() {
  const router = useRouter();

  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [carregandoConversas, setCarregandoConversas] = useState(true);
  const [conversaId, setConversaId] = useState<string | null>(null);

  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [carregandoMensagens, setCarregandoMensagens] = useState(false);

  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState("");

  const chatFimRef = useRef<HTMLDivElement>(null);

  async function carregarConversas() {
    try {
      const res = await fetch("/api/whatsapp/conversas");
      if (res.ok) setConversas(await res.json());
    } finally {
      setCarregandoConversas(false);
    }
  }

  async function carregarMensagens(id: string) {
    setCarregandoMensagens(true);
    try {
      const res = await fetch(`/api/whatsapp/conversas/${id}/mensagens`);
      if (res.ok) setMensagens(await res.json());
    } finally {
      setCarregandoMensagens(false);
    }
  }

  useEffect(() => {
    carregarConversas();
    const intervalo = setInterval(carregarConversas, POLL_MS);
    return () => clearInterval(intervalo);
  }, []);

  useEffect(() => {
    if (!conversaId) return;
    carregarMensagens(conversaId);
    const intervalo = setInterval(() => carregarMensagens(conversaId), POLL_MS);
    return () => clearInterval(intervalo);
  }, [conversaId]);

  useEffect(() => {
    chatFimRef.current?.scrollIntoView({ block: "end" });
  }, [mensagens]);

  function selecionarConversa(id: string) {
    setConversaId(id);
    setErroEnvio("");
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!conversaId || !texto.trim()) return;

    setEnviando(true);
    setErroEnvio("");
    try {
      const res = await fetch(`/api/whatsapp/conversas/${conversaId}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: texto.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErroEnvio(data?.erro ?? "Falha ao enviar mensagem.");
        return;
      }
      setTexto("");
      await Promise.all([carregarMensagens(conversaId), carregarConversas()]);
    } finally {
      setEnviando(false);
    }
  }

  async function handleSair() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const conversaAtual = conversas.find((c) => c.id === conversaId);
  const podeEnviar = janelaAberta(conversaAtual);

  return (
    <div className="flex h-screen flex-col bg-bg">
      <header className="shrink-0 border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[1360px] items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/painel")} className="text-sm text-muted hover:text-fg">
              ← Painel
            </button>
            <h1 className="font-serif text-lg font-semibold text-fg">Atendimento WhatsApp</h1>
          </div>
          <button
            onClick={handleSair}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg"
          >
            Sair
          </button>
        </div>
      </header>

      <div className="mx-auto flex w-full min-h-0 max-w-[1360px] flex-1 gap-4 overflow-hidden px-6 py-6">
        {/* Lista de conversas */}
        <div className="flex w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
          <div className="shrink-0 border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-fg">Conversas</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {carregandoConversas ? (
              <p className="px-4 py-6 text-center text-sm text-muted">Carregando...</p>
            ) : conversas.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">Nenhuma conversa ainda.</p>
            ) : (
              conversas.map((c) => {
                const estado = estadoLabel(c.estado);
                return (
                  <button
                    key={c.id}
                    onClick={() => selecionarConversa(c.id)}
                    className={`block w-full border-b border-border px-4 py-3 text-left hover:bg-bg ${
                      conversaId === c.id ? "bg-gold/10" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-fg">
                        {c.pacienteNome ?? c.telefone}
                      </span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${estado.classe}`}>
                        {estado.texto}
                      </span>
                    </div>
                    {c.ultimaMensagem && (
                      <p className="mt-1 truncate text-xs text-muted">
                        {c.ultimaMensagem.direcao === "saida" ? "Você: " : ""}
                        {c.ultimaMensagem.texto}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] text-muted">{formatarDataHora(c.ultimaMensagemEm)}</p>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Chat da conversa selecionada */}
        <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface">
          {!conversaAtual ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted">
              Selecione uma conversa à esquerda.
            </div>
          ) : (
            <>
              <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-fg">
                    {conversaAtual.pacienteNome ?? conversaAtual.telefone}
                  </p>
                  <p className="text-xs text-muted">{conversaAtual.telefone}</p>
                </div>
                <span
                  className={`rounded px-2 py-1 text-xs font-medium ${estadoLabel(conversaAtual.estado).classe}`}
                >
                  {estadoLabel(conversaAtual.estado).texto}
                </span>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
                {carregandoMensagens && mensagens.length === 0 ? (
                  <p className="text-center text-sm text-muted">Carregando...</p>
                ) : mensagens.length === 0 ? (
                  <p className="text-center text-sm text-muted">Nenhuma mensagem ainda.</p>
                ) : (
                  mensagens.map((m) => (
                    <div key={m.id} className={`flex ${m.direcao === "saida" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                          m.direcao === "saida" ? "bg-gold/10 text-fg" : "bg-bg text-fg"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{m.texto}</p>
                        <p className="mt-1 text-[10px] text-muted">
                          {formatarHora(m.criadoEm)}
                          {m.respondidaPorIa && " · IA"}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                <div ref={chatFimRef} />
              </div>

              <div className="shrink-0 border-t border-border px-4 py-3">
                {!podeEnviar && (
                  <p className="mb-2 rounded-lg bg-orange/10 px-3 py-2 text-xs text-orange">
                    Janela de 24h fechada — o paciente precisa mandar uma mensagem antes de você poder responder.
                  </p>
                )}
                {erroEnvio && (
                  <p className="mb-2 rounded-lg bg-red/10 px-3 py-2 text-xs text-red">{erroEnvio}</p>
                )}
                <form onSubmit={enviar} className="flex gap-2">
                  <input
                    type="text"
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    disabled={!podeEnviar || enviando}
                    placeholder={podeEnviar ? "Escreva uma mensagem..." : "Janela fechada"}
                    className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    disabled={!podeEnviar || enviando || !texto.trim()}
                    className="rounded-lg bg-whatsapp px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {enviando ? "..." : "Enviar"}
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
