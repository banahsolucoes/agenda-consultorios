"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

// Popup global de reconexão Google — montado no layout raiz (qualquer
// página, qualquer papel). Checa GET /api/integracoes/google/reconexao-status
// a cada troca de rota (usePathname como dependência — App Router não
// remonta o layout raiz em navegação client-side, então sem isso o "Agora
// não" ficaria dispensado pra sempre na mesma sessão, contrariando "volta a
// aparecer a cada nova carga de página"). Sem sessão (páginas públicas:
// login, formulário de anamnese, onboarding...), a rota responde
// precisaReconectar:false sem 401 — o componente fica silenciosamente
// oculto, sem erro de console.
export default function GoogleReconexaoModal() {
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);
  const [podeConectar, setPodeConectar] = useState(false);
  const [nomeClinica, setNomeClinica] = useState<string | null>(null);
  const [conectando, setConectando] = useState(false);
  const [avisando, setAvisando] = useState(false);
  const [avisoResultado, setAvisoResultado] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const intervaloRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function verificar() {
    setAvisoResultado(null);
    try {
      const res = await fetch("/api/integracoes/google/reconexao-status");
      const dados = await res.json().catch(() => null);
      if (dados?.precisaReconectar) {
        setPodeConectar(Boolean(dados.podeConectar));
        setNomeClinica(dados.nomeClinica ?? null);
        setAberto(true);
      } else {
        setAberto(false);
      }
    } catch {
      setAberto(false);
    }
  }

  useEffect(() => {
    void verificar();
  }, [pathname]);

  // Escuta o resultado do OAuth feito no popup (ver callback/route.ts —
  // postMessage restrito à própria origem). Ao receber, revalida o status:
  // se resolveu, o modal some sozinho; se não, continua aberto.
  useEffect(() => {
    function handler(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if ((event.data as { tipo?: string } | null)?.tipo !== "google-oauth-resultado") return;
      setConectando(false);
      if (intervaloRef.current) clearInterval(intervaloRef.current);
      popupRef.current = null;
      void verificar();
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  function handleConectar() {
    setConectando(true);
    const largura = 520;
    const altura = 640;
    const left = window.screenX + (window.outerWidth - largura) / 2;
    const top = window.screenY + (window.outerHeight - altura) / 2;
    const popup = window.open(
      "/api/integracoes/google/conectar?popup=1",
      "google-oauth",
      `width=${largura},height=${altura},left=${left},top=${top}`
    );
    if (!popup) {
      setConectando(false);
      return;
    }
    popupRef.current = popup;
    // Rede de segurança: se o operador fechar o popup manualmente sem
    // concluir (nunca dispara postMessage), só destrava o botão — o modal
    // continua aberto, porque o problema continua sem resolver.
    intervaloRef.current = setInterval(() => {
      if (popup.closed) {
        if (intervaloRef.current) clearInterval(intervaloRef.current);
        setConectando(false);
      }
    }, 500);
  }

  async function handleAvisar() {
    setAvisando(true);
    setAvisoResultado(null);
    try {
      const res = await fetch("/api/integracoes/google/avisar-responsavel", { method: "POST" });
      const dados = await res.json().catch(() => null);
      setAvisoResultado(
        res.ok
          ? "Responsável avisado por WhatsApp."
          : (dados?.erro ?? "Não foi possível avisar — fale diretamente com o administrador.")
      );
    } catch {
      setAvisoResultado("Não foi possível avisar — fale diretamente com o administrador.");
    } finally {
      setAvisando(false);
    }
  }

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-lg">
        <h2 className="mb-2 font-serif text-lg font-semibold text-fg">Conexão com o Google caiu</h2>
        <p className="mb-4 text-sm text-muted">
          {nomeClinica ? `A conexão da clínica ${nomeClinica}` : "A conexão"} com o Google parou de funcionar —
          agenda, Meet e pasta do Drive não sincronizam até reconectar.
        </p>

        {podeConectar ? (
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg"
            >
              Agora não
            </button>
            <button
              type="button"
              onClick={handleConectar}
              disabled={conectando}
              className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {conectando ? "Conectando..." : "Conectar agora"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Só quem administra a integração pode reconectar. Avise o responsável pela clínica.
            </p>
            {avisoResultado && (
              <p className="rounded-lg bg-gold/10 px-3 py-2 text-sm text-fg">{avisoResultado}</p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={handleAvisar}
                disabled={avisando}
                className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {avisando ? "Avisando..." : "Avisar responsável"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
