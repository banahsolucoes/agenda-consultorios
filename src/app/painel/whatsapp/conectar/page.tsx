"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Papel } from "@/lib/permissoes";
import {
  META_APP_ID,
  META_EMBEDDED_SIGNUP_CONFIG_ID,
  META_FEATURE_TYPE_COEXISTENCIA,
  META_GRAPH_API_VERSION,
} from "@/lib/whatsapp/embeddedSignup";

interface FBLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}

interface FacebookSdk {
  init(opcoes: Record<string, unknown>): void;
  login(callback: (resposta: FBLoginResponse) => void, opcoes: Record<string, unknown>): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

type Estado =
  | { tipo: "ocioso" }
  | { tipo: "aguardando" }
  | { tipo: "enviando" }
  | { tipo: "sucesso"; phoneNumberId: string; wabaId: string }
  | { tipo: "erro"; mensagem: string };

// Tempo máximo entre o FB.login devolver o code e a Meta mandar o evento
// WA_EMBEDDED_SIGNUP com waba_id/phone_number_id (os dois chegam por canais
// diferentes, em qualquer ordem).
const ESPERA_SESSAO_MS = 15_000;

function ehOrigemFacebook(origem: string): boolean {
  try {
    const host = new URL(origem).hostname;
    return host === "facebook.com" || host.endsWith(".facebook.com");
  } catch {
    return false;
  }
}

// Conexão de um número de WhatsApp pela própria clínica via Embedded Signup
// da Meta, modo Coexistência (número continua no app WhatsApp Business).
// Só ADMIN. O canal criado nasce inativo e sem webhook — não substitui nem
// altera o canal atual da agenda. Ver ARCHITECTURE.md §10.12.
export default function ConectarWhatsappPage() {
  const router = useRouter();
  const [papel, setPapel] = useState<Papel | null>(null);
  const [carregandoPapel, setCarregandoPapel] = useState(true);
  const [sdkPronto, setSdkPronto] = useState(false);
  const [erroSdk, setErroSdk] = useState(false);
  const [estado, setEstado] = useState<Estado>({ tipo: "ocioso" });

  const codeRef = useRef<string | null>(null);
  const sessaoRef = useRef<{ wabaId: string; phoneNumberId: string } | null>(null);
  // true = nenhuma tentativa em andamento (ou a atual já foi resolvida);
  // impede que eventos atrasados/duplicados da Meta mudem a tela.
  const encerradoRef = useRef(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/auth/usuario")
      .then((r) => (r.ok ? r.json() : null))
      .then((dados: { papel: Papel } | null) => setPapel(dados?.papel ?? null))
      .finally(() => setCarregandoPapel(false));
  }, []);

  const falhar = useCallback((mensagem: string) => {
    if (encerradoRef.current) return;
    encerradoRef.current = true;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setEstado({ tipo: "erro", mensagem });
  }, []);

  const tentarEnviar = useCallback(async () => {
    if (encerradoRef.current) return;
    const code = codeRef.current;
    const sessao = sessaoRef.current;
    if (!code || !sessao) return;
    encerradoRef.current = true;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setEstado({ tipo: "enviando" });

    try {
      const res = await fetch("/api/whatsapp/conectar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, wabaId: sessao.wabaId, phoneNumberId: sessao.phoneNumberId }),
      });
      const dados = await res.json().catch(() => null);
      if (!res.ok) {
        setEstado({ tipo: "erro", mensagem: dados?.erro ?? `Falha ao salvar a conexão (HTTP ${res.status}).` });
        return;
      }
      setEstado({ tipo: "sucesso", phoneNumberId: dados.phoneNumberId, wabaId: dados.wabaId });
    } catch {
      setEstado({ tipo: "erro", mensagem: "Não foi possível falar com o servidor. Tente de novo." });
    }
  }, []);

  // Carrega o Facebook JS SDK só para ADMIN.
  useEffect(() => {
    if (papel !== "ADMIN") return;
    if (window.FB) {
      // SDK já carregado e inicializado numa visita anterior a esta página
      // (navegação client-side) — só marca pronto, sem novo FB.init.
      queueMicrotask(() => setSdkPronto(true));
      return;
    }
    window.fbAsyncInit = () => {
      window.FB?.init({
        appId: META_APP_ID,
        autoLogAppEvents: true,
        xfbml: false,
        version: META_GRAPH_API_VERSION,
      });
      setSdkPronto(true);
    };
    if (!document.getElementById("facebook-jssdk")) {
      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      script.onerror = () => setErroSdk(true);
      document.body.appendChild(script);
    }
  }, [papel]);

  // Eventos do popup do Embedded Signup (waba_id/phone_number_id, cancelamento, erro).
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!ehOrigemFacebook(event.origin)) return;
      let dados: {
        type?: string;
        event?: string;
        data?: { waba_id?: unknown; phone_number_id?: unknown; current_step?: unknown; error_message?: unknown };
      };
      try {
        dados = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (!dados || dados.type !== "WA_EMBEDDED_SIGNUP") return;

      const evento = String(dados.event ?? "");
      if (evento.startsWith("FINISH")) {
        const wabaId = dados.data?.waba_id;
        const phoneNumberId = dados.data?.phone_number_id;
        if (typeof wabaId === "string" && wabaId && typeof phoneNumberId === "string" && phoneNumberId) {
          sessaoRef.current = { wabaId, phoneNumberId };
          void tentarEnviar();
        } else {
          falhar("A Meta concluiu o fluxo sem informar o número (waba_id/phone_number_id). Nenhum canal foi criado — tente de novo.");
        }
      } else if (evento === "CANCEL") {
        const etapa = typeof dados.data?.current_step === "string" ? dados.data.current_step : null;
        falhar(`Conexão cancelada${etapa ? ` na etapa "${etapa}"` : ""}. Nenhum canal foi criado.`);
      } else if (evento === "ERROR") {
        const msg = typeof dados.data?.error_message === "string" ? dados.data.error_message : "erro não informado";
        falhar(`A Meta reportou um erro: ${msg}. Nenhum canal foi criado.`);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [falhar, tentarEnviar]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function conectar() {
    if (!window.FB) return;
    codeRef.current = null;
    sessaoRef.current = null;
    encerradoRef.current = false;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setEstado({ tipo: "aguardando" });

    // Callback síncrono de propósito — o SDK não aceita função async aqui.
    window.FB.login(
      (resposta) => {
        const code = resposta.authResponse?.code;
        if (!code) {
          falhar("Conexão cancelada ou não autorizada na janela da Meta. Nenhum canal foi criado.");
          return;
        }
        codeRef.current = code;
        if (sessaoRef.current) {
          void tentarEnviar();
        } else {
          timeoutRef.current = setTimeout(() => {
            falhar("A Meta não informou o número conectado (waba_id/phone_number_id). Nenhum canal foi criado — tente de novo.");
          }, ESPERA_SESSAO_MS);
        }
      },
      {
        config_id: META_EMBEDDED_SIGNUP_CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: META_FEATURE_TYPE_COEXISTENCIA,
          sessionInfoVersion: "3",
        },
      }
    );
  }

  if (carregandoPapel) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-4">
        <p className="text-muted">Carregando...</p>
      </div>
    );
  }

  if (papel !== "ADMIN") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-4">
        <div className="text-center">
          <p className="text-fg">Você não tem permissão para acessar esta página.</p>
          <button onClick={() => router.push("/painel")} className="mt-4 text-sm text-gold hover:underline">
            Voltar ao painel
          </button>
        </div>
      </div>
    );
  }

  const ocupado = estado.tipo === "aguardando" || estado.tipo === "enviando";

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/painel")} className="text-sm text-muted hover:text-fg">
              ← Painel
            </button>
            <h1 className="font-serif text-lg font-semibold text-fg">Conectar WhatsApp</h1>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-6 py-8">
        <div className="rounded-xl border border-border bg-surface p-6">
          <p className="text-sm text-fg">
            Conecta um número de WhatsApp Business à clínica pela Meta, mantendo o número funcionando
            no aplicativo WhatsApp Business (Coexistência).
          </p>
          <p className="mt-2 text-sm text-muted">
            O número conectado aqui entra <strong>inativo e sem webhook</strong>: ele ainda não envia
            nem recebe mensagens pelo sistema, e o número atual da agenda continua igual.
          </p>

          <button
            onClick={conectar}
            disabled={!sdkPronto || ocupado}
            className="mt-6 rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {estado.tipo === "aguardando"
              ? "Aguardando a janela da Meta..."
              : estado.tipo === "enviando"
                ? "Salvando conexão..."
                : "Conectar WhatsApp"}
          </button>

          {!sdkPronto && !erroSdk && <p className="mt-3 text-xs text-muted">Carregando SDK da Meta...</p>}
          {erroSdk && (
            <p className="mt-3 text-sm text-red">
              Não foi possível carregar o SDK da Meta. Verifique bloqueadores de anúncio/rastreamento e recarregue a página.
            </p>
          )}

          {estado.tipo === "sucesso" && (
            <div className="mt-6 rounded-lg border border-green/40 bg-green/10 p-4 text-sm text-fg">
              <p className="font-medium">Número conectado.</p>
              <p className="mt-1">
                phone_number_id: <code className="font-mono">{estado.phoneNumberId}</code>
              </p>
              <p>
                waba_id: <code className="font-mono">{estado.wabaId}</code>
              </p>
              <p className="mt-2 text-muted">Canal salvo como inativo, sem webhook.</p>
            </div>
          )}

          {estado.tipo === "erro" && (
            <div className="mt-6 rounded-lg border border-red/40 bg-red/10 p-4 text-sm text-fg">
              <p className="font-medium">Não foi possível conectar.</p>
              <p className="mt-1">{estado.mensagem}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
