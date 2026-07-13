"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Papel } from "@/lib/permissoes";

interface ClinicaIntegracoes {
  pastaRaizDriveId: string | null;
  sheetsPlanilhaId: string | null;
  sheetsAba: string | null;
}

interface GoogleStatus {
  conectado: boolean;
  email?: string | null;
  calendarId?: string | null;
}

function extractSheetIdFromUrl(urlOrId: string): string {
  const match = urlOrId.match(/\/d\/([^/]+)/);
  return match ? match[1] : urlOrId;
}

// Integração Google, pasta-mãe do Drive e configuração da planilha (Google
// Sheets) de onde os pacientes são importados. Página autocontida (estado
// próprio), migrada do configuracoes/legado antigo. O disparo da importação
// em si (botão "Importar pacientes" + modal de preview) NÃO mora aqui — foi
// pra tela de pacientes (/painel), porque o OPERADOR precisa importar mas
// não acessa esta seção. Aqui fica só a configuração (fonte dos dados), que
// é mesmo restrita a ADMIN/PROFISSIONAL.
export default function IntegracoesPage() {
  const router = useRouter();
  const [papel, setPapel] = useState<Papel | null>(null);

  useEffect(() => {
    fetch("/api/auth/usuario")
      .then((r) => (r.ok ? r.json() : null))
      .then((dados: { papel: Papel } | null) => {
        if (dados?.papel === "OPERADOR") router.replace("/painel");
        else setPapel(dados?.papel ?? null);
      });
  }, [router]);

  const [clinica, setClinica] = useState<ClinicaIntegracoes | null>(null);
  const [carregandoClinica, setCarregandoClinica] = useState(true);
  const [erroCarregarClinica, setErroCarregarClinica] = useState(false);

  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [carregandoGoogle, setCarregandoGoogle] = useState(true);
  const [erroCarregarGoogle, setErroCarregarGoogle] = useState(false);
  const [desconectandoGoogle, setDesconectandoGoogle] = useState(false);
  const [avisoGoogle, setAvisoGoogle] = useState<"conectado" | "erro" | null>(null);

  const [pastaRaizInput, setPastaRaizInput] = useState("");
  const [editandoPastaRaiz, setEditandoPastaRaiz] = useState(false);
  const [confirmandoPastaRaiz, setConfirmandoPastaRaiz] = useState(false);
  const [salvandoPastaRaiz, setSalvandoPastaRaiz] = useState(false);
  const [erroPastaRaiz, setErroPastaRaiz] = useState("");
  const [sucessoPastaRaiz, setSucessoPastaRaiz] = useState(false);

  const [sheetsPlanilhaIdInput, setSheetsPlanilhaIdInput] = useState("");
  const [sheetsAbaInput, setSheetsAbaInput] = useState("");
  const [editandoSheets, setEditandoSheets] = useState(false);
  const [confirmandoSheets, setConfirmandoSheets] = useState(false);
  const [salvandoConfigSheets, setSalvandoConfigSheets] = useState(false);
  const [erroConfigSheets, setErroConfigSheets] = useState("");
  const [sucessoConfigSheets, setSucessoConfigSheets] = useState(false);

  async function carregarClinica() {
    setCarregandoClinica(true);
    setErroCarregarClinica(false);
    try {
      const res = await fetch("/api/clinica");
      if (!res.ok) {
        setErroCarregarClinica(true);
        return;
      }
      const dados: ClinicaIntegracoes = await res.json();
      setClinica(dados);
      setPastaRaizInput(dados.pastaRaizDriveId ?? "");
      setSheetsPlanilhaIdInput(dados.sheetsPlanilhaId ?? "");
      setSheetsAbaInput(dados.sheetsAba ?? "");
    } catch {
      setErroCarregarClinica(true);
    } finally {
      setCarregandoClinica(false);
    }
  }

  async function carregarGoogleStatus() {
    setCarregandoGoogle(true);
    setErroCarregarGoogle(false);
    try {
      const res = await fetch("/api/integracoes/google/status");
      if (res.ok) {
        setGoogleStatus(await res.json());
      } else {
        setErroCarregarGoogle(true);
      }
    } catch {
      setErroCarregarGoogle(true);
    } finally {
      setCarregandoGoogle(false);
    }
  }

  useEffect(() => {
    void (async () => {
      await Promise.all([carregarClinica(), carregarGoogleStatus()]);

      // O callback do OAuth redireciona de volta pra cá com ?google_conectado=1
      // ou ?google_erro=1 — lê uma vez e limpa da URL pra não reaparecer num reload.
      const params = new URLSearchParams(window.location.search);
      if (params.has("google_conectado")) setAvisoGoogle("conectado");
      else if (params.has("google_erro")) setAvisoGoogle("erro");
      if (params.has("google_conectado") || params.has("google_erro")) {
        router.replace("/painel/configuracoes/integracoes");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleConectarGoogle() {
    window.location.href = "/api/integracoes/google/conectar";
  }

  async function handleDesconectarGoogle() {
    setDesconectandoGoogle(true);
    try {
      await fetch("/api/integracoes/google/desconectar", { method: "POST" });
      await carregarGoogleStatus();
      setAvisoGoogle(null);
    } finally {
      setDesconectandoGoogle(false);
    }
  }

  function abrirEdicaoPastaRaiz() {
    setPastaRaizInput(clinica?.pastaRaizDriveId ?? "");
    setErroPastaRaiz("");
    setSucessoPastaRaiz(false);
    setEditandoPastaRaiz(true);
  }

  function cancelarEdicaoPastaRaiz() {
    setEditandoPastaRaiz(false);
    setConfirmandoPastaRaiz(false);
    setErroPastaRaiz("");
  }

  // Só abre a confirmação — a validação de verdade (formato do ID + pasta
  // acessível pela conta conectada) acontece no servidor, ao confirmar.
  function pedirConfirmacaoPastaRaiz(e: React.FormEvent) {
    e.preventDefault();
    setErroPastaRaiz("");
    setConfirmandoPastaRaiz(true);
  }

  async function handleSalvarPastaRaiz() {
    setErroPastaRaiz("");
    setSucessoPastaRaiz(false);
    setSalvandoPastaRaiz(true);

    try {
      const res = await fetch("/api/clinica", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pastaRaizDriveId: pastaRaizInput || null }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErroPastaRaiz(data?.erro ?? "não foi possível salvar");
        setConfirmandoPastaRaiz(false);
        return;
      }

      const atualizada = await res.json();
      setClinica((c) => (c ? { ...c, pastaRaizDriveId: atualizada.pastaRaizDriveId } : c));
      setPastaRaizInput(atualizada.pastaRaizDriveId ?? "");
      setSucessoPastaRaiz(true);
      setConfirmandoPastaRaiz(false);
      setEditandoPastaRaiz(false);
    } catch {
      setErroPastaRaiz("não foi possível salvar");
      setConfirmandoPastaRaiz(false);
    } finally {
      setSalvandoPastaRaiz(false);
    }
  }

  function abrirEdicaoSheets() {
    setSheetsPlanilhaIdInput(clinica?.sheetsPlanilhaId ?? "");
    setSheetsAbaInput(clinica?.sheetsAba ?? "");
    setErroConfigSheets("");
    setSucessoConfigSheets(false);
    setEditandoSheets(true);
  }

  function cancelarEdicaoSheets() {
    setEditandoSheets(false);
    setConfirmandoSheets(false);
    setErroConfigSheets("");
  }

  function pedirConfirmacaoSheets(e: React.FormEvent) {
    e.preventDefault();
    setErroConfigSheets("");
    setConfirmandoSheets(true);
  }

  async function handleSalvarSheets() {
    setErroConfigSheets("");
    setSucessoConfigSheets(false);
    setSalvandoConfigSheets(true);

    try {
      const res = await fetch("/api/clinica", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheetsPlanilhaId: sheetsPlanilhaIdInput || null,
          sheetsAba: sheetsAbaInput || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErroConfigSheets(data?.erro ?? "não foi possível salvar");
        setConfirmandoSheets(false);
        return;
      }

      const atualizada = await res.json();
      setClinica((c) =>
        c ? { ...c, sheetsPlanilhaId: atualizada.sheetsPlanilhaId, sheetsAba: atualizada.sheetsAba } : c
      );
      setSheetsPlanilhaIdInput(atualizada.sheetsPlanilhaId ?? "");
      setSheetsAbaInput(atualizada.sheetsAba ?? "");
      setSucessoConfigSheets(true);
      setConfirmandoSheets(false);
      setEditandoSheets(false);
    } catch {
      setErroConfigSheets("não foi possível salvar");
      setConfirmandoSheets(false);
    } finally {
      setSalvandoConfigSheets(false);
    }
  }

  if (papel !== null && papel === "OPERADOR") return null;

  return (
    <div className="space-y-8">
      <h2 className="font-serif text-lg font-semibold text-fg">Integrações</h2>

      {/* Integração Google */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <h3 className="mb-1 font-serif text-base font-semibold text-fg">Integração Google</h3>
        <p className="mb-4 text-sm text-muted">
          Conecte a conta Google da clínica para criar automaticamente o link do Meet nas sessões online.
        </p>

        {avisoGoogle === "conectado" && (
          <p className="mb-4 rounded-lg bg-green/10 px-3 py-2 text-sm text-green">
            Google conectado com sucesso.
          </p>
        )}
        {avisoGoogle === "erro" && (
          <p className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
            Não foi possível concluir a conexão com o Google. Tente novamente.
          </p>
        )}

        {carregandoGoogle ? (
          <p className="text-sm text-muted">Carregando...</p>
        ) : erroCarregarGoogle || !googleStatus ? (
          <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
            Não foi possível carregar o status da integração.
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border p-4">
            <div className="flex items-center gap-3">
              <span className={`h-2.5 w-2.5 rounded-full ${googleStatus.conectado ? "bg-green" : "bg-muted"}`} />
              <div>
                <p className="text-sm font-medium text-fg">{googleStatus.conectado ? "Conectado" : "Desconectado"}</p>
                {googleStatus.conectado && (
                  <p className="text-xs text-muted">
                    {googleStatus.email ?? "conta conectada (e-mail indisponível no momento)"}
                  </p>
                )}
              </div>
            </div>

            {googleStatus.conectado ? (
              <button
                onClick={handleDesconectarGoogle}
                disabled={desconectandoGoogle}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                {desconectandoGoogle ? "Desconectando..." : "Desconectar"}
              </button>
            ) : (
              <button
                onClick={handleConectarGoogle}
                className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110"
              >
                Conectar Google
              </button>
            )}
          </div>
        )}

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-fg">Pasta-mãe do Drive</label>

          {carregandoClinica ? (
            <p className="text-sm text-muted">Carregando...</p>
          ) : erroCarregarClinica || !clinica ? (
            <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
              Não foi possível carregar os dados da clínica.
            </p>
          ) : !editandoPastaRaiz ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2">
              {clinica.pastaRaizDriveId ? (
                <span className="truncate font-mono text-sm text-fg">{clinica.pastaRaizDriveId}</span>
              ) : (
                <span className="text-sm text-muted">Nenhuma pasta-mãe configurada</span>
              )}
              <button
                type="button"
                onClick={abrirEdicaoPastaRaiz}
                className="shrink-0 rounded-lg border border-border px-3 py-1 text-sm font-medium text-fg hover:bg-bg"
              >
                Alterar
              </button>
            </div>
          ) : (
            <form onSubmit={pedirConfirmacaoPastaRaiz} className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                autoFocus
                value={pastaRaizInput}
                onChange={(e) => {
                  setPastaRaizInput(e.target.value);
                  setSucessoPastaRaiz(false);
                }}
                placeholder="https://drive.google.com/drive/folders/..."
                className="min-w-[240px] flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
              />
              <button
                type="submit"
                disabled={salvandoPastaRaiz}
                className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Salvar
              </button>
              <button
                type="button"
                onClick={cancelarEdicaoPastaRaiz}
                disabled={salvandoPastaRaiz}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
            </form>
          )}

          <p className="mt-1 text-xs text-muted">
            Cole o link da pasta (ou já o ID) — as pastas dos pacientes novos são criadas
            automaticamente aqui dentro, quando o Google estiver conectado. Mudar isso afeta
            onde as pastas novas são criadas, por isso fica protegido por padrão.
          </p>
          {erroPastaRaiz && !confirmandoPastaRaiz && (
            <p className="mt-2 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroPastaRaiz}</p>
          )}
          {sucessoPastaRaiz && (
            <p className="mt-2 rounded-lg bg-green/10 px-3 py-2 text-sm text-green">Pasta-mãe salva.</p>
          )}
        </div>
      </section>

      {/* Configuração da planilha (Google Sheets) */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <h3 className="mb-1 font-serif text-base font-semibold text-fg">
          Importação de formulário (Google Sheets)
        </h3>
        <p className="mb-4 text-sm text-muted">
          Configure a planilha do Google Sheets de onde os dados dos pacientes serão importados.
          O disparo da importação fica na tela de Pacientes.
        </p>

        {carregandoClinica ? (
          <p className="text-sm text-muted">Carregando...</p>
        ) : erroCarregarClinica || !clinica ? (
          <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
            Não foi possível carregar os dados da clínica.
          </p>
        ) : (
          <>
            {!editandoSheets ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2">
                  <div className="min-w-0">
                    <span className="text-xs text-muted">Planilha</span>
                    {clinica.sheetsPlanilhaId ? (
                      <p className="truncate font-mono text-sm text-fg">{clinica.sheetsPlanilhaId}</p>
                    ) : (
                      <p className="text-sm text-muted">Nenhuma planilha configurada</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={abrirEdicaoSheets}
                    className="shrink-0 rounded-lg border border-border px-3 py-1 text-sm font-medium text-fg hover:bg-bg"
                  >
                    Alterar
                  </button>
                </div>

                <div className="rounded-lg border border-border bg-bg px-3 py-2">
                  <span className="text-xs text-muted">Aba</span>
                  <p className="text-sm text-fg">{clinica.sheetsAba || "Padrão (Página1)"}</p>
                </div>
              </div>
            ) : (
              <form onSubmit={pedirConfirmacaoSheets} className="flex flex-wrap items-center gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">ID ou link da planilha</label>
                  <input
                    type="text"
                    autoFocus
                    value={sheetsPlanilhaIdInput}
                    onChange={(e) => {
                      const id = extractSheetIdFromUrl(e.target.value);
                      setSheetsPlanilhaIdInput(id);
                      setErroConfigSheets("");
                      setSucessoConfigSheets(false);
                    }}
                    placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  />
                  <p className="mt-1 text-xs text-muted">
                    Cole o ID da planilha ou o link completo. O ID é a parte entre /d/ e /edit na URL.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Nome da aba</label>
                  <input
                    type="text"
                    value={sheetsAbaInput}
                    onChange={(e) => {
                      setSheetsAbaInput(e.target.value);
                      setErroConfigSheets("");
                      setSucessoConfigSheets(false);
                    }}
                    placeholder="Página1"
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  />
                  <p className="mt-1 text-xs text-muted">
                    Deixe em branco para usar a primeira aba (padrão: &quot;Página1&quot;).
                  </p>
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    type="submit"
                    disabled={salvandoConfigSheets}
                    className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {salvandoConfigSheets ? "Salvando..." : "Salvar"}
                  </button>
                  <button
                    type="button"
                    onClick={cancelarEdicaoSheets}
                    disabled={salvandoConfigSheets}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}

            {erroConfigSheets && !confirmandoSheets && (
              <p className="mt-2 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroConfigSheets}</p>
            )}
            {sucessoConfigSheets && (
              <p className="mt-2 rounded-lg bg-green/10 px-3 py-2 text-sm text-green">Configurações salvas.</p>
            )}
          </>
        )}
      </section>

      {/* Modal: confirmar alteração da pasta-mãe do Drive */}
      {confirmandoPastaRaiz && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">Alterar pasta-mãe do Drive</h2>
            <p className="mb-4 rounded-lg bg-gold/10 px-3 py-2 text-sm text-fg">
              Alterar a pasta raiz afeta onde novas pastas de pacientes serão criadas. Confirmar?
            </p>

            {erroPastaRaiz && (
              <p className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroPastaRaiz}</p>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmandoPastaRaiz(false)}
                disabled={salvandoPastaRaiz}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSalvarPastaRaiz}
                disabled={salvandoPastaRaiz}
                className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {salvandoPastaRaiz ? "Salvando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: confirmar alteração da configuração do Sheets */}
      {confirmandoSheets && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">Alterar configuração da planilha</h2>
            <p className="mb-4 rounded-lg bg-gold/10 px-3 py-2 text-sm text-fg">
              Alterar a planilha ou aba afeta onde os dados dos pacientes serão importados. Confirmar?
            </p>

            {erroConfigSheets && (
              <p className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroConfigSheets}</p>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmandoSheets(false)}
                disabled={salvandoConfigSheets}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSalvarSheets}
                disabled={salvandoConfigSheets}
                className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {salvandoConfigSheets ? "Salvando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
