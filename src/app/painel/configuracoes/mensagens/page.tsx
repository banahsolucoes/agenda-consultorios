"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Papel } from "@/lib/permissoes";
import CampoTexto from "../_components/CampoTexto";

interface Mensagens {
  emailBoasVindasAssunto: string;
  emailBoasVindasCorpo: string;
  templateConfirmacao: string;
  templateMeet: string;
}

// E-mail de boas-vindas (ao compartilhar a pasta do paciente) e templates de
// copiar-colar (confirmação e link do Meet). Página autocontida: carrega e
// salva por conta própria via GET/PATCH /api/clinica, sem depender do estado
// do configuracoes/legado antigo. Os placeholders das duas seções (ex.:
// {nome}, {saudacao}) são renderizados em outro lugar (src/lib/emailBoasVindas.ts
// e src/lib/templatesMensagem.ts) — os nomes não podem mudar aqui.
export default function MensagensPage() {
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

  const [carregando, setCarregando] = useState(true);
  const [erroCarregar, setErroCarregar] = useState(false);
  const [form, setForm] = useState<Mensagens | null>(null);

  const [salvandoEmail, setSalvandoEmail] = useState(false);
  const [erroEmail, setErroEmail] = useState("");
  const [sucessoEmail, setSucessoEmail] = useState(false);

  const [salvandoTemplates, setSalvandoTemplates] = useState(false);
  const [erroTemplates, setErroTemplates] = useState("");
  const [sucessoTemplates, setSucessoTemplates] = useState(false);

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
        const dados = await res.json();
        setForm({
          emailBoasVindasAssunto: dados.emailBoasVindasAssunto,
          emailBoasVindasCorpo: dados.emailBoasVindasCorpo,
          templateConfirmacao: dados.templateConfirmacao,
          templateMeet: dados.templateMeet,
        });
      } catch {
        setErroCarregar(true);
      } finally {
        setCarregando(false);
      }
    }
    carregar();
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    setForm((f) => (f ? { ...f, [name]: value } : f));
    setSucessoEmail(false);
    setSucessoTemplates(false);
  }

  async function handleSalvarEmailBoasVindas(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setErroEmail("");
    setSucessoEmail(false);
    setSalvandoEmail(true);

    try {
      const res = await fetch("/api/clinica", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailBoasVindasAssunto: form.emailBoasVindasAssunto,
          emailBoasVindasCorpo: form.emailBoasVindasCorpo,
        }),
      });

      const dados = await res.json().catch(() => null);
      if (!res.ok) {
        setErroEmail(dados?.erro ?? "não foi possível salvar");
        return;
      }

      setForm((f) =>
        f
          ? { ...f, emailBoasVindasAssunto: dados.emailBoasVindasAssunto, emailBoasVindasCorpo: dados.emailBoasVindasCorpo }
          : f
      );
      setSucessoEmail(true);
    } catch {
      setErroEmail("não foi possível salvar");
    } finally {
      setSalvandoEmail(false);
    }
  }

  async function handleSalvarTemplatesMensagem(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setErroTemplates("");
    setSucessoTemplates(false);
    setSalvandoTemplates(true);

    try {
      const res = await fetch("/api/clinica", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateConfirmacao: form.templateConfirmacao,
          templateMeet: form.templateMeet,
        }),
      });

      const dados = await res.json().catch(() => null);
      if (!res.ok) {
        setErroTemplates(dados?.erro ?? "não foi possível salvar");
        return;
      }

      setForm((f) =>
        f ? { ...f, templateConfirmacao: dados.templateConfirmacao, templateMeet: dados.templateMeet } : f
      );
      setSucessoTemplates(true);
    } catch {
      setErroTemplates("não foi possível salvar");
    } finally {
      setSalvandoTemplates(false);
    }
  }

  if (papel !== null && papel === "OPERADOR") return null;

  return (
    <div className="space-y-8">
      <h2 className="font-serif text-lg font-semibold text-fg">Mensagens</h2>

      {carregando ? (
        <p className="text-sm text-muted">Carregando...</p>
      ) : erroCarregar || !form ? (
        <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
          Não foi possível carregar os dados da clínica.
        </p>
      ) : (
        <>
          {/* E-mail de boas-vindas */}
          <section className="rounded-xl border border-border bg-surface p-6">
            <h3 className="mb-1 font-serif text-base font-semibold text-fg">Email de boas-vindas</h3>
            <p className="mb-4 text-sm text-muted">
              Template usado ao compartilhar a pasta de um paciente. <strong>{"{nome}"}</strong>{" "}
              é substituído pelo primeiro nome do paciente, e <strong>{"{link_pasta}"}</strong>{" "}
              vira o botão com o link da pasta do Drive.
            </p>

            <form onSubmit={handleSalvarEmailBoasVindas} className="space-y-4">
              <CampoTexto
                label="Assunto"
                name="emailBoasVindasAssunto"
                value={form.emailBoasVindasAssunto}
                onChange={handleChange}
                required
              />

              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Corpo</label>
                <textarea
                  name="emailBoasVindasCorpo"
                  value={form.emailBoasVindasCorpo}
                  onChange={handleChange}
                  required
                  rows={10}
                  className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>

              {erroEmail && (
                <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroEmail}</p>
              )}
              {sucessoEmail && (
                <p className="rounded-lg bg-green/10 px-3 py-2 text-sm text-green">Template salvo.</p>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={salvandoEmail}
                  className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvandoEmail ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </section>

          {/* Mensagens de copiar-colar (confirmação e link do Meet) */}
          <section className="rounded-xl border border-border bg-surface p-6">
            <h3 className="mb-1 font-serif text-base font-semibold text-fg">Mensagens de copiar-colar</h3>
            <p className="mb-4 text-sm text-muted">
              Textos usados nos botões &quot;Copiar confirmação&quot; e &quot;Copiar link do Meet&quot;, na agenda e
              no painel do paciente. Variáveis disponíveis:{" "}
              <strong>{"{saudacao}"}</strong> (Bom dia/Boa tarde/Boa noite, conforme o horário atual),{" "}
              <strong>{"{paciente}"}</strong> (primeiro nome), <strong>{"{data}"}</strong> (dd/mm),{" "}
              <strong>{"{hora}"}</strong> (HH:MM), <strong>{"{horarioLimite}"}</strong> (limite de confirmação da
              clínica), <strong>{"{linkMeet}"}</strong> (link da sessão) e <strong>{"{assistente}"}</strong> (nome
              do assistente).
            </p>

            <form onSubmit={handleSalvarTemplatesMensagem} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Texto de confirmação</label>
                <textarea
                  name="templateConfirmacao"
                  value={form.templateConfirmacao}
                  onChange={handleChange}
                  required
                  rows={10}
                  className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Texto do link do Meet</label>
                <textarea
                  name="templateMeet"
                  value={form.templateMeet}
                  onChange={handleChange}
                  required
                  rows={8}
                  className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>

              {erroTemplates && (
                <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroTemplates}</p>
              )}
              {sucessoTemplates && (
                <p className="rounded-lg bg-green/10 px-3 py-2 text-sm text-green">Template salvo.</p>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={salvandoTemplates}
                  className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvandoTemplates ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
