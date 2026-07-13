"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { diaSemanaLabel } from "@/lib/labels";
import type { Papel } from "@/lib/permissoes";
import CampoCor from "../_components/CampoCor";

const DIAS_SEMANA = [
  "SEGUNDA",
  "TERCA",
  "QUARTA",
  "QUINTA",
  "SEXTA",
  "SABADO",
  "DOMINGO",
] as const;

const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

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

const FORM_TIPO_VAZIO = {
  nome: "",
  cor: "#c9a96e",
  duracaoPadraoMin: "45",
  ehOnline: false,
  ehAtendimentoUnico: false,
  valor: "",
};

interface ConfigAtendimento {
  duracaoPadraoMin: number;
  horarioLimiteConfirmacao: string;
  permitirResizeSessao: boolean;
}

// Seção "Atendimento": horários de trabalho, tipos de atendimento (com cor) e
// os 3 campos de config de atendimento — migrados do configuracoes/legado
// antigo, autocontidos (estado próprio, não depende do page.tsx antigo).
// Horários e tipos são liberados pro OPERADOR nas rotas de API; os 3 campos
// de config só salvam via PATCH /api/clinica, que o OPERADOR não tem
// permissão — por isso ficam desabilitados pra ele aqui.
export default function AtendimentoPage() {
  const router = useRouter();
  const [papel, setPapel] = useState<Papel | null>(null);

  useEffect(() => {
    fetch("/api/auth/usuario")
      .then((r) => (r.ok ? r.json() : null))
      .then((dados: { papel: Papel } | null) => {
        if (!dados) {
          router.replace("/login");
          return;
        }
        setPapel(dados.papel);
      });
  }, [router]);

  const podeConfigGeral = papel !== null && papel !== "OPERADOR";

  // Horários de trabalho
  const [horarios, setHorarios] = useState<FaixaHorario[]>([]);
  const [carregandoHorarios, setCarregandoHorarios] = useState(true);
  const [erroCarregarHorarios, setErroCarregarHorarios] = useState(false);
  const [novaFaixa, setNovaFaixa] = useState<Record<string, { horaInicio: string; horaFim: string }>>({});
  const [erroFaixa, setErroFaixa] = useState<Record<string, string>>({});
  const [salvandoFaixa, setSalvandoFaixa] = useState<string | null>(null);
  const [removendoId, setRemovendoId] = useState<string | null>(null);

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

  // Tipos de atendimento
  const [tiposSessao, setTiposSessao] = useState<TipoSessaoItem[]>([]);
  const [carregandoTipos, setCarregandoTipos] = useState(true);
  const [erroCarregarTipos, setErroCarregarTipos] = useState(false);
  const [formTipo, setFormTipo] = useState(FORM_TIPO_VAZIO);
  const [modalTipoAberto, setModalTipoAberto] = useState(false);
  const [editandoTipoId, setEditandoTipoId] = useState<string | null>(null);
  const [salvandoTipo, setSalvandoTipo] = useState(false);
  const [erroTipo, setErroTipo] = useState("");
  const [excluindoTipo, setExcluindoTipo] = useState<TipoSessaoItem | null>(null);
  const [erroExcluirTipo, setErroExcluirTipo] = useState("");
  const [removendoTipoId, setRemovendoTipoId] = useState<string | null>(null);

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

  function handleChangeFormTipo(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value, type, checked } = e.target;
    setFormTipo((f) => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  }

  function abrirNovoTipo() {
    setEditandoTipoId(null);
    setFormTipo(FORM_TIPO_VAZIO);
    setErroTipo("");
    setModalTipoAberto(true);
  }

  function abrirEdicaoTipo(tipo: TipoSessaoItem) {
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
    setModalTipoAberto(true);
  }

  function fecharModalTipo() {
    setModalTipoAberto(false);
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
        setErroTipo(data?.erro ?? "não foi possível salvar o tipo de atendimento");
        return;
      }

      setModalTipoAberto(false);
      await carregarTiposSessao();
    } catch {
      setErroTipo("não foi possível salvar o tipo de atendimento");
    } finally {
      setSalvandoTipo(false);
    }
  }

  function abrirExcluirTipo(tipo: TipoSessaoItem) {
    setExcluindoTipo(tipo);
    setErroExcluirTipo("");
  }

  async function handleConfirmarExcluirTipo() {
    if (!excluindoTipo) return;
    setRemovendoTipoId(excluindoTipo.id);
    setErroExcluirTipo("");
    try {
      const res = await fetch(`/api/clinica/tipos-sessao/${excluindoTipo.id}`, { method: "DELETE" });
      if (res.ok) {
        if (editandoTipoId === excluindoTipo.id) setModalTipoAberto(false);
        setExcluindoTipo(null);
        await carregarTiposSessao();
      } else {
        const data = await res.json().catch(() => null);
        setErroExcluirTipo(data?.erro ?? "não foi possível remover o tipo de atendimento");
      }
    } finally {
      setRemovendoTipoId(null);
    }
  }

  // Config de atendimento (só ADMIN/PROFISSIONAL editam — PATCH /api/clinica)
  const [config, setConfig] = useState<ConfigAtendimento | null>(null);
  const [carregandoConfig, setCarregandoConfig] = useState(true);
  const [erroCarregarConfig, setErroCarregarConfig] = useState(false);
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [erroConfig, setErroConfig] = useState("");
  const [sucessoConfig, setSucessoConfig] = useState(false);

  async function carregarConfig() {
    setCarregandoConfig(true);
    setErroCarregarConfig(false);
    try {
      const res = await fetch("/api/clinica");
      if (!res.ok) {
        setErroCarregarConfig(true);
        return;
      }
      const dados = await res.json();
      setConfig({
        duracaoPadraoMin: dados.duracaoPadraoMin,
        horarioLimiteConfirmacao: dados.horarioLimiteConfirmacao,
        permitirResizeSessao: dados.permitirResizeSessao,
      });
    } catch {
      setErroCarregarConfig(true);
    } finally {
      setCarregandoConfig(false);
    }
  }

  function handleChangeConfig(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value, type, checked } = e.target;
    setConfig((c) =>
      c
        ? {
            ...c,
            [name]: type === "checkbox" ? checked : name === "duracaoPadraoMin" ? Number(value) : value,
          }
        : c
    );
    setSucessoConfig(false);
  }

  async function handleSalvarConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!config) return;
    setErroConfig("");
    setSucessoConfig(false);
    setSalvandoConfig(true);
    try {
      const res = await fetch("/api/clinica", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const dados = await res.json().catch(() => null);
      if (!res.ok) {
        setErroConfig(dados?.erro ?? "não foi possível salvar");
        return;
      }
      setConfig({
        duracaoPadraoMin: dados.duracaoPadraoMin,
        horarioLimiteConfirmacao: dados.horarioLimiteConfirmacao,
        permitirResizeSessao: dados.permitirResizeSessao,
      });
      setSucessoConfig(true);
    } catch {
      setErroConfig("não foi possível salvar");
    } finally {
      setSalvandoConfig(false);
    }
  }

  useEffect(() => {
    void (async () => {
      await Promise.all([carregarHorarios(), carregarTiposSessao(), carregarConfig()]);
    })();
  }, []);

  return (
    <div className="space-y-8">
      <h2 className="font-serif text-lg font-semibold text-fg">Atendimento</h2>

      {/* Horário de trabalho */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <h3 className="mb-1 font-serif text-base font-semibold text-fg">Horário de trabalho</h3>
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
                    {faixasDoDia.length === 0 && <span className="text-sm text-muted">Não atende</span>}
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
                  {erroFaixa[dia] && <p className="mt-2 text-sm text-red">{erroFaixa[dia]}</p>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Tipos de atendimento */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-serif text-base font-semibold text-fg">Tipos de atendimento</h3>
            <p className="mt-1 text-sm text-muted">
              Defina os tipos de atendimento oferecidos pela clínica (ex.: Sessão online, Avaliação presencial).
            </p>
          </div>
          <button
            onClick={abrirNovoTipo}
            className="shrink-0 rounded-lg bg-gold px-3 py-1.5 text-sm font-medium text-bg hover:brightness-110"
          >
            Novo tipo de atendimento
          </button>
        </div>

        {carregandoTipos ? (
          <p className="text-sm text-muted">Carregando...</p>
        ) : erroCarregarTipos ? (
          <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
            Não foi possível carregar os tipos de atendimento.
          </p>
        ) : tiposSessao.length === 0 ? (
          <p className="text-sm text-muted">Nenhum tipo de atendimento cadastrado ainda.</p>
        ) : (
          <ul className="space-y-2">
            {tiposSessao.map((tipo) => (
              <li
                key={tipo.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border border-border"
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
                    onClick={() => abrirEdicaoTipo(tipo)}
                    className="rounded-lg border border-border px-3 py-1 text-sm text-fg hover:bg-bg"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => abrirExcluirTipo(tipo)}
                    className="rounded-lg border border-border px-3 py-1 text-sm text-red hover:bg-red/10"
                  >
                    Excluir
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Config de atendimento — só ADMIN/PROFISSIONAL editam (PATCH /api/clinica) */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <h3 className="mb-1 font-serif text-base font-semibold text-fg">Configurações de atendimento</h3>
        {!podeConfigGeral && (
          <p className="mb-4 text-sm text-muted">Somente administrador pode alterar.</p>
        )}

        {carregandoConfig ? (
          <p className="text-sm text-muted">Carregando...</p>
        ) : erroCarregarConfig || !config ? (
          <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
            Não foi possível carregar a configuração de atendimento.
          </p>
        ) : (
          <form onSubmit={handleSalvarConfig} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <fieldset disabled={!podeConfigGeral} className="contents">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">
                  Duração padrão da sessão (min)
                </label>
                <input
                  type="number"
                  name="duracaoPadraoMin"
                  min={1}
                  value={config.duracaoPadraoMin}
                  onChange={handleChangeConfig}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-fg">
                  Horário limite p/ confirmação (HH:MM)
                </label>
                <input
                  type="text"
                  name="horarioLimiteConfirmacao"
                  value={config.horarioLimiteConfirmacao}
                  onChange={handleChangeConfig}
                  pattern="^([01]\d|2[0-3]):[0-5]\d$"
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-fg">
                  Permitir redimensionar a duração da sessão arrastando a borda no calendário
                </label>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="permitirResizeSessao"
                    checked={config.permitirResizeSessao}
                    onChange={handleChangeConfig}
                    className="h-4 w-4 text-gold border-border bg-gray-100 rounded focus:ring-gold-500"
                  />
                  <span className="ml-2 text-sm text-fg">
                    Quando ativado, o usuário pode alterar a duração da sessão arrastando a borda inferior do bloco na agenda.
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Normalmente apenas o arrastar para mudar horário está disponível.
                </p>
              </div>

              {erroConfig && (
                <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red sm:col-span-2">{erroConfig}</p>
              )}
              {sucessoConfig && (
                <p className="rounded-lg bg-green/10 px-3 py-2 text-sm text-green sm:col-span-2">
                  Alterações salvas.
                </p>
              )}

              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={salvandoConfig}
                  className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvandoConfig ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </fieldset>
          </form>
        )}
      </section>

      {/* Modal: criar/editar tipo de atendimento */}
      {modalTipoAberto && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">
              {editandoTipoId ? "Editar tipo de atendimento" : "Novo tipo de atendimento"}
            </h2>
            <form onSubmit={handleSalvarTipo} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

              <CampoCor label="Cor" name="cor" value={formTipo.cor} onChange={handleChangeFormTipo} />

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
                <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red sm:col-span-2">{erroTipo}</p>
              )}

              <div className="flex justify-end gap-3 sm:col-span-2">
                <button
                  type="button"
                  onClick={fecharModalTipo}
                  disabled={salvandoTipo}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoTipo}
                  className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvandoTipo ? "Salvando..." : editandoTipoId ? "Salvar alterações" : "Adicionar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: confirmar exclusão de tipo de atendimento */}
      {excluindoTipo && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">Excluir {excluindoTipo.nome}</h2>
            <p className="mb-4 text-sm text-muted">
              Tem certeza que deseja excluir este tipo de atendimento? Essa ação não pode ser desfeita.
            </p>

            {erroExcluirTipo && (
              <p className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroExcluirTipo}</p>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setExcluindoTipo(null)}
                disabled={removendoTipoId === excluindoTipo.id}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={handleConfirmarExcluirTipo}
                disabled={removendoTipoId === excluindoTipo.id}
                className="rounded-lg bg-red px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {removendoTipoId === excluindoTipo.id ? "Excluindo..." : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
