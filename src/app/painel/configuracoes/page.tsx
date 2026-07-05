"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { diaSemanaLabel } from "@/lib/labels";

const DIAS_SEMANA = [
  "SEGUNDA",
  "TERCA",
  "QUARTA",
  "QUINTA",
  "SEXTA",
  "SABADO",
  "DOMINGO",
] as const;

interface Clinica {
  id: string;
  nome: string;
  logo: string | null;
  corPrimaria: string | null;
  corSecundaria: string | null;
  duracaoPadraoMin: number;
  nomeAssistente: string;
  horarioLimiteConfirmacao: string;
}

interface FaixaHorario {
  id: string;
  diaSemana: string;
  horaInicio: string;
  horaFim: string;
}

interface TipoSessaoItem {
  id: string;
  nome: string;
  cor: string | null;
  duracaoPadraoMin: number;
  ehOnline: boolean;
  ehAtendimentoUnico: boolean;
  valor: string | null;
}

interface GoogleStatus {
  conectado: boolean;
  email?: string | null;
  calendarId?: string | null;
}

const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const FORM_TIPO_VAZIO = {
  nome: "",
  cor: "#c9a96e",
  duracaoPadraoMin: "45",
  ehOnline: false,
  ehAtendimentoUnico: false,
  valor: "",
};

export default function ConfiguracoesPage() {
  const router = useRouter();

  const [clinica, setClinica] = useState<Clinica | null>(null);
  const [carregandoClinica, setCarregandoClinica] = useState(true);
  const [salvandoClinica, setSalvandoClinica] = useState(false);
  const [erroClinica, setErroClinica] = useState("");
  const [sucessoClinica, setSucessoClinica] = useState(false);

  const [horarios, setHorarios] = useState<FaixaHorario[]>([]);
  const [carregandoHorarios, setCarregandoHorarios] = useState(true);
  const [erroCarregarHorarios, setErroCarregarHorarios] = useState(false);
  const [novaFaixa, setNovaFaixa] = useState<Record<string, { horaInicio: string; horaFim: string }>>({});
  const [erroFaixa, setErroFaixa] = useState<Record<string, string>>({});
  const [salvandoFaixa, setSalvandoFaixa] = useState<string | null>(null);
  const [removendoId, setRemovendoId] = useState<string | null>(null);
  const [erroCarregarClinica, setErroCarregarClinica] = useState(false);

  const [tiposSessao, setTiposSessao] = useState<TipoSessaoItem[]>([]);
  const [carregandoTipos, setCarregandoTipos] = useState(true);
  const [erroCarregarTipos, setErroCarregarTipos] = useState(false);
  const [formTipo, setFormTipo] = useState(FORM_TIPO_VAZIO);
  const [editandoTipoId, setEditandoTipoId] = useState<string | null>(null);
  const [salvandoTipo, setSalvandoTipo] = useState(false);
  const [erroTipo, setErroTipo] = useState("");
  const [removendoTipoId, setRemovendoTipoId] = useState<string | null>(null);

  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [carregandoGoogle, setCarregandoGoogle] = useState(true);
  const [erroCarregarGoogle, setErroCarregarGoogle] = useState(false);
  const [desconectandoGoogle, setDesconectandoGoogle] = useState(false);
  const [avisoGoogle, setAvisoGoogle] = useState<"conectado" | "erro" | null>(null);

  async function carregarClinica() {
    setCarregandoClinica(true);
    setErroCarregarClinica(false);
    try {
      const res = await fetch("/api/clinica");
      if (res.ok) {
        setClinica(await res.json());
      } else {
        setErroCarregarClinica(true);
      }
    } catch {
      setErroCarregarClinica(true);
    } finally {
      setCarregandoClinica(false);
    }
  }

  async function carregarHorarios() {
    setCarregandoHorarios(true);
    setErroCarregarHorarios(false);
    try {
      const res = await fetch("/api/clinica/horarios");
      if (res.ok) {
        setHorarios(await res.json());
      } else {
        setErroCarregarHorarios(true);
      }
    } catch {
      setErroCarregarHorarios(true);
    } finally {
      setCarregandoHorarios(false);
    }
  }

  async function carregarTiposSessao() {
    setCarregandoTipos(true);
    setErroCarregarTipos(false);
    try {
      const res = await fetch("/api/clinica/tipos-sessao");
      if (res.ok) {
        setTiposSessao(await res.json());
      } else {
        setErroCarregarTipos(true);
      }
    } catch {
      setErroCarregarTipos(true);
    } finally {
      setCarregandoTipos(false);
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
    carregarClinica();
    carregarHorarios();
    carregarTiposSessao();
    carregarGoogleStatus();

    // O callback do OAuth redireciona de volta pra cá com ?google_conectado=1
    // ou ?google_erro=1 — lê uma vez e limpa da URL pra não reaparecer num reload.
    const params = new URLSearchParams(window.location.search);
    if (params.has("google_conectado")) setAvisoGoogle("conectado");
    else if (params.has("google_erro")) setAvisoGoogle("erro");
    if (params.has("google_conectado") || params.has("google_erro")) {
      router.replace("/painel/configuracoes");
    }
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

  function handleChangeClinica(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const { name, value } = e.target;
    setClinica((c) => (c ? { ...c, [name]: value } : c));
    setSucessoClinica(false);
  }

  async function handleSalvarClinica(e: React.FormEvent) {
    e.preventDefault();
    if (!clinica) return;
    setErroClinica("");
    setSucessoClinica(false);
    setSalvandoClinica(true);

    try {
      const res = await fetch("/api/clinica", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: clinica.nome,
          logo: clinica.logo,
          corPrimaria: clinica.corPrimaria,
          corSecundaria: clinica.corSecundaria,
          duracaoPadraoMin: clinica.duracaoPadraoMin,
          nomeAssistente: clinica.nomeAssistente,
          horarioLimiteConfirmacao: clinica.horarioLimiteConfirmacao,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErroClinica(data?.erro ?? "não foi possível salvar");
        return;
      }

      setClinica(await res.json());
      setSucessoClinica(true);
    } catch {
      setErroClinica("não foi possível salvar");
    } finally {
      setSalvandoClinica(false);
    }
  }

  function faixaEmEdicao(dia: string) {
    return novaFaixa[dia] ?? { horaInicio: "", horaFim: "" };
  }

  function atualizarFaixaEmEdicao(dia: string, campo: "horaInicio" | "horaFim", valor: string) {
    setNovaFaixa((f) => ({ ...f, [dia]: { ...faixaEmEdicao(dia), [campo]: valor } }));
  }

  async function handleAdicionarFaixa(dia: string) {
    const faixa = faixaEmEdicao(dia);
    setErroFaixa((f) => ({ ...f, [dia]: "" }));

    if (!HORA_REGEX.test(faixa.horaInicio) || !HORA_REGEX.test(faixa.horaFim)) {
      setErroFaixa((f) => ({ ...f, [dia]: "horários devem estar no formato HH:MM" }));
      return;
    }

    setSalvandoFaixa(dia);
    try {
      const res = await fetch("/api/clinica/horarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diaSemana: dia, horaInicio: faixa.horaInicio, horaFim: faixa.horaFim }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErroFaixa((f) => ({ ...f, [dia]: data?.erro ?? "não foi possível adicionar" }));
        return;
      }

      setNovaFaixa((f) => ({ ...f, [dia]: { horaInicio: "", horaFim: "" } }));
      await carregarHorarios();
    } catch {
      setErroFaixa((f) => ({ ...f, [dia]: "não foi possível adicionar" }));
    } finally {
      setSalvandoFaixa(null);
    }
  }

  async function handleRemoverFaixa(id: string) {
    setRemovendoId(id);
    try {
      const res = await fetch(`/api/clinica/horarios?id=${id}`, { method: "DELETE" });
      if (res.ok) await carregarHorarios();
    } finally {
      setRemovendoId(null);
    }
  }

  async function handleSair() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  function handleChangeFormTipo(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const { name, value, type, checked } = e.target;
    setFormTipo((f) => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  }

  function iniciarNovoTipo() {
    setEditandoTipoId(null);
    setFormTipo(FORM_TIPO_VAZIO);
    setErroTipo("");
  }

  function iniciarEdicaoTipo(tipo: TipoSessaoItem) {
    setEditandoTipoId(tipo.id);
    setFormTipo({
      nome: tipo.nome,
      cor: tipo.cor ?? "#c9a96e",
      duracaoPadraoMin: String(tipo.duracaoPadraoMin),
      ehOnline: tipo.ehOnline,
      ehAtendimentoUnico: tipo.ehAtendimentoUnico,
      valor: tipo.valor ?? "",
    });
    setErroTipo("");
  }

  async function handleSalvarTipo(e: React.FormEvent) {
    e.preventDefault();
    setErroTipo("");
    setSalvandoTipo(true);

    try {
      const res = await fetch(
        editandoTipoId ? `/api/clinica/tipos-sessao/${editandoTipoId}` : "/api/clinica/tipos-sessao",
        {
          method: editandoTipoId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nome: formTipo.nome,
            cor: formTipo.cor,
            duracaoPadraoMin: formTipo.duracaoPadraoMin,
            ehOnline: formTipo.ehOnline,
            ehAtendimentoUnico: formTipo.ehAtendimentoUnico,
            valor: formTipo.valor || null,
          }),
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErroTipo(data?.erro ?? "não foi possível salvar o tipo de sessão");
        return;
      }

      iniciarNovoTipo();
      await carregarTiposSessao();
    } catch {
      setErroTipo("não foi possível salvar o tipo de sessão");
    } finally {
      setSalvandoTipo(false);
    }
  }

  async function handleRemoverTipo(id: string) {
    setRemovendoTipoId(id);
    try {
      const res = await fetch(`/api/clinica/tipos-sessao/${id}`, { method: "DELETE" });
      if (res.ok) {
        if (editandoTipoId === id) iniciarNovoTipo();
        await carregarTiposSessao();
      } else {
        const data = await res.json().catch(() => null);
        setErroTipo(data?.erro ?? "não foi possível remover o tipo de sessão");
      }
    } finally {
      setRemovendoTipoId(null);
    }
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/painel")}
              className="text-sm text-muted hover:text-fg"
            >
              ← Painel
            </button>
            <h1 className="font-serif text-lg font-semibold text-fg">
              Configurações
            </h1>
          </div>
          <button
            onClick={handleSair}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg"
          >
            Sair
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8 space-y-8">
        {/* Dados gerais */}
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="mb-4 font-serif text-lg font-semibold text-fg">
            Dados gerais
          </h2>

          {carregandoClinica ? (
            <p className="text-sm text-muted">Carregando...</p>
          ) : erroCarregarClinica || !clinica ? (
            <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
              Não foi possível carregar os dados da clínica.
            </p>
          ) : (
            <form onSubmit={handleSalvarClinica} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <CampoTexto label="Nome da clínica" name="nome" value={clinica.nome} onChange={handleChangeClinica} className="sm:col-span-2" />
              <CampoTexto label="Nome do assistente" name="nomeAssistente" value={clinica.nomeAssistente} onChange={handleChangeClinica} />
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">
                  Duração padrão da sessão (min)
                </label>
                <input
                  type="number"
                  min={1}
                  value={clinica.duracaoPadraoMin}
                  onChange={(e) =>
                    setClinica((c) => (c ? { ...c, duracaoPadraoMin: Number(e.target.value) } : c))
                  }
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
              <CampoTexto
                label="Horário limite p/ confirmação (HH:MM)"
                name="horarioLimiteConfirmacao"
                value={clinica.horarioLimiteConfirmacao}
                onChange={handleChangeClinica}
                pattern="^([01]\d|2[0-3]):[0-5]\d$"
              />
              <CampoTexto label="Logo (URL)" name="logo" value={clinica.logo ?? ""} onChange={handleChangeClinica} />
              <CampoCor label="Cor primária" name="corPrimaria" value={clinica.corPrimaria ?? "#c9a96e"} onChange={handleChangeClinica} />
              <CampoCor label="Cor secundária" name="corSecundaria" value={clinica.corSecundaria ?? "#1a1a1a"} onChange={handleChangeClinica} />

              {erroClinica && (
                <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red sm:col-span-2">
                  {erroClinica}
                </p>
              )}
              {sucessoClinica && (
                <p className="rounded-lg bg-green/10 px-3 py-2 text-sm text-green sm:col-span-2">
                  Alterações salvas.
                </p>
              )}

              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={salvandoClinica}
                  className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvandoClinica ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          )}
        </section>

        {/* Integração Google */}
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="mb-1 font-serif text-lg font-semibold text-fg">
            Integração Google
          </h2>
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
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    googleStatus.conectado ? "bg-green" : "bg-muted"
                  }`}
                />
                <div>
                  <p className="text-sm font-medium text-fg">
                    {googleStatus.conectado ? "Conectado" : "Desconectado"}
                  </p>
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
        </section>

        {/* Horário de trabalho */}
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="mb-1 font-serif text-lg font-semibold text-fg">
            Horário de trabalho
          </h2>
          <p className="mb-4 text-sm text-muted">
            Defina uma ou mais faixas de atendimento por dia. Um dia sem faixas significa que a clínica não atende.
          </p>

          {carregandoHorarios ? (
            <p className="text-sm text-muted">Carregando...</p>
          ) : erroCarregarHorarios ? (
            <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
              Não foi possível carregar os horários de trabalho.
            </p>
          ) : (
            <div className="space-y-4">
              {DIAS_SEMANA.map((dia) => {
                const faixasDoDia = horarios.filter((h) => h.diaSemana === dia);
                const emEdicao = faixaEmEdicao(dia);
                return (
                  <div key={dia} className="rounded-lg border border-border p-3">
                    <p className="mb-2 text-sm font-medium text-fg">{diaSemanaLabel(dia)}</p>

                    <div className="mb-2 flex flex-wrap gap-2">
                      {faixasDoDia.length === 0 && (
                        <span className="text-sm text-muted">Não atende</span>
                      )}
                      {faixasDoDia.map((f) => (
                        <span
                          key={f.id}
                          className="flex items-center gap-2 rounded-full border border-border bg-bg px-3 py-1 text-sm text-fg"
                        >
                          {f.horaInicio}–{f.horaFim}
                          <button
                            onClick={() => handleRemoverFaixa(f.id)}
                            disabled={removendoId === f.id}
                            aria-label={`Remover faixa ${f.horaInicio}-${f.horaFim} de ${diaSemanaLabel(dia)}`}
                            className="text-muted hover:text-red disabled:opacity-60"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        placeholder="08:00"
                        pattern="^([01]\d|2[0-3]):[0-5]\d$"
                        value={emEdicao.horaInicio}
                        onChange={(e) => atualizarFaixaEmEdicao(dia, "horaInicio", e.target.value)}
                        className="w-20 rounded-lg border border-border bg-bg px-2 py-1 text-sm text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                      />
                      <span className="text-muted">até</span>
                      <input
                        type="text"
                        placeholder="12:00"
                        pattern="^([01]\d|2[0-3]):[0-5]\d$"
                        value={emEdicao.horaFim}
                        onChange={(e) => atualizarFaixaEmEdicao(dia, "horaFim", e.target.value)}
                        className="w-20 rounded-lg border border-border bg-bg px-2 py-1 text-sm text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                      />
                      <button
                        onClick={() => handleAdicionarFaixa(dia)}
                        disabled={salvandoFaixa === dia}
                        className="rounded-lg border border-gold px-3 py-1 text-sm font-medium text-gold hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        + Adicionar
                      </button>
                    </div>
                    {erroFaixa[dia] && (
                      <p className="mt-2 text-sm text-red">{erroFaixa[dia]}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Tipos de sessão */}
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="mb-1 font-serif text-lg font-semibold text-fg">
            Tipos de sessão
          </h2>
          <p className="mb-4 text-sm text-muted">
            Defina os tipos de sessão oferecidos pela clínica (ex.: Sessão online, Avaliação presencial).
          </p>

          {carregandoTipos ? (
            <p className="text-sm text-muted">Carregando...</p>
          ) : erroCarregarTipos ? (
            <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
              Não foi possível carregar os tipos de sessão.
            </p>
          ) : (
            <>
              {tiposSessao.length === 0 ? (
                <p className="mb-4 text-sm text-muted">Nenhum tipo de sessão cadastrado ainda.</p>
              ) : (
                <ul className="mb-4 space-y-2">
                  {tiposSessao.map((tipo) => (
                    <li
                      key={tipo.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="h-4 w-4 rounded-full border border-border"
                          style={{ backgroundColor: tipo.cor ?? "#c9a96e" }}
                        />
                        <div>
                          <p className="text-sm font-medium text-fg">{tipo.nome}</p>
                          <p className="text-xs text-muted">
                            {tipo.duracaoPadraoMin} min · {tipo.ehOnline ? "Online" : "Presencial"}
                            {tipo.ehAtendimentoUnico ? " · Atendimento único" : ""}
                            {tipo.valor ? ` · R$ ${tipo.valor}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => iniciarEdicaoTipo(tipo)}
                          className="rounded-lg border border-border px-3 py-1 text-sm text-fg hover:bg-bg"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleRemoverTipo(tipo.id)}
                          disabled={removendoTipoId === tipo.id}
                          className="rounded-lg border border-border px-3 py-1 text-sm text-red hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Remover
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <form
                onSubmit={handleSalvarTipo}
                className="grid grid-cols-1 gap-4 rounded-lg border border-border p-4 sm:grid-cols-2"
              >
                <p className="text-sm font-medium text-fg sm:col-span-2">
                  {editandoTipoId ? "Editar tipo de sessão" : "Novo tipo de sessão"}
                </p>

                <div className="sm:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-fg">Nome</label>
                  <input
                    type="text"
                    name="nome"
                    value={formTipo.nome}
                    onChange={handleChangeFormTipo}
                    required
                    placeholder="Sessão online"
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Cor</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      name="cor"
                      value={formTipo.cor}
                      onChange={handleChangeFormTipo}
                      className="h-9 w-12 cursor-pointer rounded border border-border bg-bg"
                    />
                    <input
                      type="text"
                      name="cor"
                      value={formTipo.cor}
                      onChange={handleChangeFormTipo}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Duração padrão (min)</label>
                  <input
                    type="number"
                    name="duracaoPadraoMin"
                    min={1}
                    value={formTipo.duracaoPadraoMin}
                    onChange={handleChangeFormTipo}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  />
                </div>

                <label className="flex items-center gap-2 text-sm font-medium text-fg">
                  <input
                    type="checkbox"
                    name="ehOnline"
                    checked={formTipo.ehOnline}
                    onChange={handleChangeFormTipo}
                    className="h-4 w-4 rounded border-border accent-gold"
                  />
                  É online
                </label>

                <div className="sm:col-span-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-fg">
                    <input
                      type="checkbox"
                      name="ehAtendimentoUnico"
                      checked={formTipo.ehAtendimentoUnico}
                      onChange={handleChangeFormTipo}
                      className="h-4 w-4 rounded border-border accent-gold"
                    />
                    Atendimento único (só avulsa)
                  </label>
                  <p className="mt-1 text-xs text-muted">
                    Tipos marcados assim representam atendimentos de entrada que só acontecem uma
                    vez (ex: avaliação, primeira consulta).
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Valor (R$, opcional)</label>
                  <input
                    type="number"
                    name="valor"
                    min={0}
                    step="0.01"
                    value={formTipo.valor}
                    onChange={handleChangeFormTipo}
                    placeholder="150.00"
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  />
                </div>

                {erroTipo && (
                  <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red sm:col-span-2">
                    {erroTipo}
                  </p>
                )}

                <div className="flex justify-end gap-3 sm:col-span-2">
                  {editandoTipoId && (
                    <button
                      type="button"
                      onClick={iniciarNovoTipo}
                      disabled={salvandoTipo}
                      className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Cancelar
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={salvandoTipo}
                    className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {salvandoTipo ? "Salvando..." : editandoTipoId ? "Salvar alterações" : "Adicionar"}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function CampoTexto({
  label,
  name,
  value,
  onChange,
  pattern,
  className = "",
}: {
  label: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  pattern?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-sm font-medium text-fg">{label}</label>
      <input
        type="text"
        name={name}
        value={value}
        onChange={onChange}
        pattern={pattern}
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
      />
    </div>
  );
}

function CampoCor({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-fg">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          name={name}
          value={value}
          onChange={onChange}
          className="h-9 w-12 cursor-pointer rounded border border-border bg-bg"
        />
        <input
          type="text"
          name={name}
          value={value}
          onChange={onChange}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
        />
      </div>
    </div>
  );
}
