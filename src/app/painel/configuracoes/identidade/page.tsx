"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Papel } from "@/lib/permissoes";
import { AJUSTE_FUNDO_PADRAO, OPCOES_AJUSTE_FUNDO, estiloFundoTela } from "@/lib/fundo";
import CampoCor from "../_components/CampoCor";

interface Clinica {
  id: string;
  nome: string;
  nomeExibicao: string | null;
  logo: string | null;
  fundoUrl: string | null;
  fundoOpacidade: number;
  fundoAjuste: string;
  corPrimaria: string | null;
  corSecundaria: string | null;
}

// Logo, fundo de tela e cores da marca. Página autocontida: carrega e salva
// por conta própria via GET/PATCH /api/clinica e POST /api/clinica/branding
// (upload de logo/fundo) — sem depender do estado do configuracoes/legado
// antigo. Reutiliza o helper de estilo de fundo (src/lib/fundo.ts) pra não
// dessincronizar do preview usado no restante do painel.
export default function IdentidadePage() {
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

  const [clinica, setClinica] = useState<Clinica | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroCarregar, setErroCarregar] = useState(false);

  const [nomeExibicaoInput, setNomeExibicaoInput] = useState("");
  const [opacidadeInput, setOpacidadeInput] = useState(100);
  const [fundoAjusteInput, setFundoAjusteInput] = useState(AJUSTE_FUNDO_PADRAO);
  const [corPrimariaInput, setCorPrimariaInput] = useState("#c9a96e");
  const [corSecundariaInput, setCorSecundariaInput] = useState("#1a1a1a");

  const [enviandoLogo, setEnviandoLogo] = useState(false);
  const [erroLogo, setErroLogo] = useState("");
  const [enviandoFundo, setEnviandoFundo] = useState(false);
  const [erroFundo, setErroFundo] = useState("");

  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState("");
  const [salvo, setSalvo] = useState(false);

  useEffect(() => {
    async function carregar() {
      setCarregando(true);
      setErroCarregar(false);
      try {
        const res = await fetch("/api/clinica");
        if (!res.ok) {
          setErroCarregar(true);
          return;
        }
        const dados: Clinica = await res.json();
        setClinica(dados);
        setNomeExibicaoInput(dados.nomeExibicao ?? "");
        setOpacidadeInput(dados.fundoOpacidade ?? 100);
        setFundoAjusteInput(dados.fundoAjuste ?? AJUSTE_FUNDO_PADRAO);
        setCorPrimariaInput(dados.corPrimaria ?? "#c9a96e");
        setCorSecundariaInput(dados.corSecundaria ?? "#1a1a1a");
      } catch {
        setErroCarregar(true);
      } finally {
        setCarregando(false);
      }
    }
    carregar();
  }, []);

  async function handleUploadImagem(tipo: "logo" | "fundo", arquivo: File) {
    const setEnviando = tipo === "logo" ? setEnviandoLogo : setEnviandoFundo;
    const setErro = tipo === "logo" ? setErroLogo : setErroFundo;
    setErro("");
    setEnviando(true);

    try {
      const formData = new FormData();
      formData.append("tipo", tipo);
      formData.append("arquivo", arquivo);

      const res = await fetch("/api/clinica/branding", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErro(data?.erro ?? "não foi possível enviar a imagem");
        return;
      }

      const atualizada: Clinica = await res.json();
      setClinica(atualizada);
      setOpacidadeInput(atualizada.fundoOpacidade ?? 100);
      setFundoAjusteInput(atualizada.fundoAjuste ?? AJUSTE_FUNDO_PADRAO);
    } catch {
      setErro("não foi possível enviar a imagem");
    } finally {
      setEnviando(false);
    }
  }

  async function handleSalvar() {
    setErroSalvar("");
    setSalvo(false);
    setSalvando(true);

    try {
      const res = await fetch("/api/clinica", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nomeExibicao: nomeExibicaoInput || null,
          fundoOpacidade: opacidadeInput,
          fundoAjuste: fundoAjusteInput,
          corPrimaria: corPrimariaInput,
          corSecundaria: corSecundariaInput,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErroSalvar(data?.erro ?? "não foi possível salvar");
        return;
      }

      const atualizada: Clinica = await res.json();
      setClinica(atualizada);
      setNomeExibicaoInput(atualizada.nomeExibicao ?? "");
      setOpacidadeInput(atualizada.fundoOpacidade ?? 100);
      setFundoAjusteInput(atualizada.fundoAjuste ?? AJUSTE_FUNDO_PADRAO);
      setCorPrimariaInput(atualizada.corPrimaria ?? "#c9a96e");
      setCorSecundariaInput(atualizada.corSecundaria ?? "#1a1a1a");
      setSalvo(true);
    } catch {
      setErroSalvar("não foi possível salvar");
    } finally {
      setSalvando(false);
    }
  }

  if (papel !== null && papel === "OPERADOR") return null;

  return (
    <div>
      <h2 className="mb-4 font-serif text-lg font-semibold text-fg">Identidade visual</h2>

      {carregando ? (
        <p className="text-sm text-muted">Carregando...</p>
      ) : erroCarregar || !clinica ? (
        <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
          Não foi possível carregar os dados da clínica.
        </p>
      ) : (
        <div className="space-y-6">
          {/* Texto ao lado da logo */}
          <div>
            <label className="mb-1 block text-sm font-medium text-fg">Texto ao lado da logo</label>
            <input
              type="text"
              value={nomeExibicaoInput}
              onChange={(e) => {
                setNomeExibicaoInput(e.target.value);
                setSalvo(false);
              }}
              placeholder={clinica.nome}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
            <p className="mt-1 text-xs text-muted">
              Exibido no canto superior esquerdo do painel. Deixe em branco para usar o nome da clínica (&quot;{clinica.nome}&quot;).
            </p>
          </div>

          {/* Logo */}
          <div>
            <p className="mb-2 text-sm font-medium text-fg">Logo</p>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-bg">
                {clinica.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={clinica.logo} alt="Logo da clínica" className="h-full w-full object-contain" />
                ) : (
                  <span className="px-1 text-center text-[10px] text-muted">Sem logo</span>
                )}
              </div>
              <label className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-bg">
                {enviandoLogo ? "Enviando..." : "Escolher imagem"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  disabled={enviandoLogo}
                  onChange={(e) => {
                    const arquivo = e.target.files?.[0];
                    if (arquivo) handleUploadImagem("logo", arquivo);
                    e.target.value = "";
                  }}
                  className="hidden"
                />
              </label>
            </div>
            <p className="mt-1 text-xs text-muted">PNG, JPG, SVG ou WEBP, até 5MB.</p>
            {erroLogo && <p className="mt-2 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroLogo}</p>}
          </div>

          {/* Fundo de tela */}
          <div>
            <p className="mb-2 text-sm font-medium text-fg">Fundo de tela</p>
            <div className="flex flex-wrap items-center gap-4">
              <div
                className="flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-bg"
                style={
                  clinica.fundoUrl
                    ? {
                        backgroundImage: `url(${clinica.fundoUrl})`,
                        opacity: opacidadeInput / 100,
                        ...estiloFundoTela(fundoAjusteInput),
                      }
                    : undefined
                }
              >
                {!clinica.fundoUrl && <span className="text-[10px] text-muted">Sem fundo</span>}
              </div>
              <label className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-bg">
                {enviandoFundo ? "Enviando..." : "Escolher imagem"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  disabled={enviandoFundo}
                  onChange={(e) => {
                    const arquivo = e.target.files?.[0];
                    if (arquivo) handleUploadImagem("fundo", arquivo);
                    e.target.value = "";
                  }}
                  className="hidden"
                />
              </label>
            </div>
            <p className="mt-1 text-xs text-muted">PNG, JPG, SVG ou WEBP, até 5MB.</p>
            {erroFundo && <p className="mt-2 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroFundo}</p>}

            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-fg">Ajuste da imagem</label>
              <select
                value={fundoAjusteInput}
                onChange={(e) => {
                  setFundoAjusteInput(e.target.value);
                  setSalvo(false);
                }}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
              >
                {OPCOES_AJUSTE_FUNDO.map((opcao) => (
                  <option key={opcao.valor} value={opcao.valor}>
                    {opcao.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4">
              <label className="mb-1 flex items-center justify-between text-sm font-medium text-fg">
                <span>Opacidade do fundo</span>
                <span className="text-muted">{opacidadeInput}%</span>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={opacidadeInput}
                onChange={(e) => {
                  setOpacidadeInput(Number(e.target.value));
                  setSalvo(false);
                }}
                className="w-full accent-gold"
              />
            </div>
          </div>

          {/* Cores da marca */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <CampoCor
              label="Cor primária"
              name="corPrimaria"
              value={corPrimariaInput}
              onChange={(e) => {
                setCorPrimariaInput(e.target.value);
                setSalvo(false);
              }}
            />
            <CampoCor
              label="Cor secundária"
              name="corSecundaria"
              value={corSecundariaInput}
              onChange={(e) => {
                setCorSecundariaInput(e.target.value);
                setSalvo(false);
              }}
            />
          </div>

          {erroSalvar && (
            <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroSalvar}</p>
          )}
          {salvo && (
            <p className="rounded-lg bg-green/10 px-3 py-2 text-sm text-green">Identidade visual salva.</p>
          )}

          <div>
            <button
              type="button"
              onClick={handleSalvar}
              disabled={salvando}
              className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {salvando ? "Salvando..." : "Salvar identidade visual"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
