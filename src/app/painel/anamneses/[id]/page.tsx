"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatarDataHoraSP } from "@/lib/timezone";
import { cpfMatematicamenteValido, formatarCpf, soDigitosCpf } from "@/lib/cpf";

interface Resposta {
  id: string;
  ordem: number;
  rotuloSnapshot: string;
  valor: string;
  campoPaciente: string | null;
}

interface EnvioDetalhe {
  id: string;
  status: "PENDENTE" | "IGNORADO" | "PROCESSADO";
  criadoEm: string;
  pacienteId: string | null;
  consentimentoAceito: boolean;
  consentimentoEm: string;
  textoConsentimentoSnapshot: string;
  observacaoProcessamento: string | null;
  formularioTitulo: string;
  respostas: Resposta[];
  camposPaciente: Record<string, string>;
  pacienteSugerido: { id: string; nome: string; cpf: string | null } | null;
}

interface PacienteBusca {
  id: string;
  nome: string;
  telefone: string | null;
  cpf: string | null;
  statusGeral: string;
}

const CAMPOS_FORM: { campo: string; rotulo: string; tipo?: "date" }[] = [
  { campo: "nome", rotulo: "Nome completo" },
  { campo: "cpf", rotulo: "CPF" },
  { campo: "telefone", rotulo: "Telefone (WhatsApp)" },
  { campo: "email", rotulo: "E-mail" },
  { campo: "dataNascimento", rotulo: "Data de nascimento", tipo: "date" },
  { campo: "rg", rotulo: "RG" },
  { campo: "estadoCivil", rotulo: "Estado civil" },
  { campo: "nacionalidade", rotulo: "Nacionalidade" },
  { campo: "profissao", rotulo: "Profissão" },
  { campo: "logradouro", rotulo: "Endereço" },
  { campo: "cep", rotulo: "CEP" },
  { campo: "instagram", rotulo: "Instagram" },
  { campo: "quemIndicou", rotulo: "Quem indicou" },
];

type Acao = "criar" | "vincular" | "ignorar" | null;

export default function DetalheAnamnesePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [envio, setEnvio] = useState<EnvioDetalhe | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroCarregar, setErroCarregar] = useState("");

  const [acao, setAcao] = useState<Acao>(null);
  const [enviando, setEnviando] = useState(false);
  const [erroAcao, setErroAcao] = useState("");

  // Ação A — criar paciente novo
  const [camposForm, setCamposForm] = useState<Record<string, string>>({});

  // Ação B — vincular a paciente existente
  const [pacienteEscolhido, setPacienteEscolhido] = useState<PacienteBusca | { id: string; nome: string; cpf: string | null } | null>(null);
  const [buscaTexto, setBuscaTexto] = useState("");
  const [resultadosBusca, setResultadosBusca] = useState<PacienteBusca[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [complementarCadastro, setComplementarCadastro] = useState(false);

  // Ação C — ignorar
  const [motivoIgnorar, setMotivoIgnorar] = useState("");

  async function carregar() {
    setCarregando(true);
    setErroCarregar("");
    try {
      const res = await fetch(`/api/anamneses/${id}`);
      if (res.status === 403) {
        setErroCarregar("Você não tem permissão para acessar esta página.");
        return;
      }
      if (res.status === 404) {
        setErroCarregar("Envio não encontrado.");
        return;
      }
      if (!res.ok) {
        setErroCarregar("Não foi possível carregar o envio.");
        return;
      }
      const dados: EnvioDetalhe = await res.json();
      setEnvio(dados);
      setCamposForm(dados.camposPaciente);
      if (dados.pacienteSugerido) setPacienteEscolhido(dados.pacienteSugerido);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!buscaTexto.trim() || buscaTexto.trim().length < 2) {
      setResultadosBusca([]);
      return;
    }
    const timeout = setTimeout(async () => {
      setBuscando(true);
      try {
        const res = await fetch(`/api/pacientes?busca=${encodeURIComponent(buscaTexto.trim())}`);
        if (res.ok) setResultadosBusca(await res.json());
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [buscaTexto]);

  const cpfFormValor = camposForm.cpf || "";
  const cpfFormValido = !cpfFormValor || cpfMatematicamenteValido(cpfFormValor);
  const nomeFormValido = (camposForm.nome || "").trim().length > 0;

  async function confirmarCriarPaciente() {
    setEnviando(true);
    setErroAcao("");
    try {
      const res = await fetch(`/api/anamneses/${id}/criar-paciente`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ camposPaciente: camposForm }),
      });
      if (!res.ok) {
        const corpo = await res.json().catch(() => ({}));
        setErroAcao(corpo.erro || "não foi possível criar o paciente");
        return;
      }
      router.push("/painel/anamneses");
    } finally {
      setEnviando(false);
    }
  }

  async function confirmarVincular() {
    if (!pacienteEscolhido) return;
    setEnviando(true);
    setErroAcao("");
    try {
      const res = await fetch(`/api/anamneses/${id}/vincular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pacienteId: pacienteEscolhido.id, complementarCadastro }),
      });
      if (!res.ok) {
        const corpo = await res.json().catch(() => ({}));
        setErroAcao(corpo.erro || "não foi possível vincular");
        return;
      }
      router.push("/painel/anamneses");
    } finally {
      setEnviando(false);
    }
  }

  async function confirmarIgnorar() {
    if (!motivoIgnorar.trim()) return;
    setEnviando(true);
    setErroAcao("");
    try {
      const res = await fetch(`/api/anamneses/${id}/ignorar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivoIgnorar.trim() }),
      });
      if (!res.ok) {
        const corpo = await res.json().catch(() => ({}));
        setErroAcao(corpo.erro || "não foi possível ignorar");
        return;
      }
      router.push("/painel/anamneses");
    } finally {
      setEnviando(false);
    }
  }

  if (carregando) {
    return <div className="min-h-screen bg-bg" />;
  }

  if (erroCarregar || !envio) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-4">
        <div className="text-center">
          <p className="text-fg">{erroCarregar || "Envio não encontrado."}</p>
          <button onClick={() => router.push("/painel/anamneses")} className="mt-4 text-sm text-gold hover:underline">
            Voltar à fila
          </button>
        </div>
      </div>
    );
  }

  const jaProcessado = envio.status !== "PENDENTE";
  const nomeEnvio = envio.camposPaciente.nome || "(sem nome)";
  const cpfEnvioDigitos = envio.camposPaciente.cpf ? soDigitosCpf(envio.camposPaciente.cpf) : "";

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/painel/anamneses")} className="text-sm text-muted hover:text-fg">
              ← Anamneses
            </button>
            <h1 className="font-serif text-lg font-semibold text-fg">{nomeEnvio}</h1>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-8">
        {jaProcessado && (
          <div className="mb-6 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
            Este envio já foi processado — status <strong className="text-fg">{envio.status}</strong>
            {envio.observacaoProcessamento && <> — {envio.observacaoProcessamento}</>}.
          </div>
        )}

        {/* Consentimento */}
        <div className="mb-6 rounded-xl border border-border bg-surface p-5">
          <p className="text-sm text-fg">
            Consentimento aceito em <strong>{formatarDataHoraSP(new Date(envio.consentimentoEm))}</strong>
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-muted hover:text-fg">Ver texto do consentimento</summary>
            <div className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-bg p-3 text-xs text-muted">
              {envio.textoConsentimentoSnapshot}
            </div>
          </details>
        </div>

        {/* Respostas */}
        <div className="mb-6 rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-3 font-serif text-base font-semibold text-fg">Respostas</h2>
          <dl className="flex flex-col gap-3">
            {envio.respostas.map((r) => (
              <div key={r.id}>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted">{r.rotuloSnapshot}</dt>
                <dd className="text-sm text-fg">{r.valor}</dd>
              </div>
            ))}
          </dl>
        </div>

        {!jaProcessado && (
          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="mb-4 font-serif text-base font-semibold text-fg">O que fazer com este envio?</h2>

            {!acao && (
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => setAcao("criar")}
                  className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110"
                >
                  Criar paciente novo
                </button>
                <button
                  onClick={() => setAcao("vincular")}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg"
                >
                  Vincular a paciente existente
                  {envio.pacienteSugerido && (
                    <span className="ml-2 rounded-full bg-blue/10 px-2 py-0.5 text-xs font-medium text-blue">
                      match sugerido
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setAcao("ignorar")}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-bg"
                >
                  Ignorar
                </button>
              </div>
            )}

            {acao === "criar" && (
              <div>
                <button onClick={() => setAcao(null)} className="mb-4 text-sm text-muted hover:text-fg">
                  ← escolher outra ação
                </button>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {CAMPOS_FORM.map(({ campo, rotulo, tipo }) => (
                    <div key={campo}>
                      <label className="mb-1 block text-sm font-medium text-fg">
                        {rotulo}
                        {campo === "nome" && <span className="ml-1 text-red">*</span>}
                      </label>
                      <input
                        type={tipo === "date" ? "date" : "text"}
                        value={
                          campo === "cpf" && tipo !== "date"
                            ? formatarCpf(camposForm.cpf || "")
                            : camposForm[campo] || ""
                        }
                        onChange={(e) =>
                          setCamposForm((prev) => ({
                            ...prev,
                            [campo]: campo === "cpf" ? soDigitosCpf(e.target.value) : e.target.value,
                          }))
                        }
                        className={`w-full rounded-lg border bg-bg px-3 py-2 text-fg outline-none focus:ring-2 focus:ring-gold/20 ${
                          campo === "cpf" && !cpfFormValido ? "border-red" : "border-border focus:border-gold"
                        }`}
                      />
                      {campo === "cpf" && !cpfFormValido && (
                        <p className="mt-1 text-xs text-red">CPF inválido — corrija ou esvazie o campo.</p>
                      )}
                    </div>
                  ))}
                </div>

                {!cpfFormValor && (
                  <p className="mt-4 rounded-lg bg-orange/10 px-3 py-2 text-sm text-orange">
                    Sem CPF, este paciente não será reconhecido automaticamente em envios futuros do
                    formulário — um novo preenchimento criará outro cadastro.
                  </p>
                )}

                {erroAcao && <p className="mt-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroAcao}</p>}

                <button
                  onClick={confirmarCriarPaciente}
                  disabled={!nomeFormValido || !cpfFormValido || enviando}
                  className="mt-4 rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {enviando ? "Criando..." : "Confirmar criação do paciente"}
                </button>
              </div>
            )}

            {acao === "vincular" && (
              <div>
                <button onClick={() => setAcao(null)} className="mb-4 text-sm text-muted hover:text-fg">
                  ← escolher outra ação
                </button>

                {envio.pacienteSugerido && !pacienteEscolhido && (
                  <div className="mb-4 rounded-lg border border-blue/30 bg-blue/10 p-3">
                    <p className="text-sm text-fg">
                      CPF bate com <strong>{envio.pacienteSugerido.nome}</strong>, já cadastrado.
                    </p>
                    <button
                      onClick={() => setPacienteEscolhido(envio.pacienteSugerido)}
                      className="mt-2 rounded-lg bg-gold px-3 py-1.5 text-sm font-medium text-bg hover:brightness-110"
                    >
                      Usar este paciente
                    </button>
                  </div>
                )}

                {!pacienteEscolhido && (
                  <div className="mb-4">
                    <label className="mb-1 block text-sm font-medium text-fg">Buscar paciente por nome ou CPF</label>
                    <input
                      type="text"
                      value={buscaTexto}
                      onChange={(e) => setBuscaTexto(e.target.value)}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                      placeholder="Digite ao menos 2 caracteres..."
                    />
                    {buscando && <p className="mt-1 text-xs text-muted">Buscando...</p>}
                    {resultadosBusca.length > 0 && (
                      <div className="mt-2 flex flex-col gap-1 rounded-lg border border-border bg-bg p-2">
                        {resultadosBusca.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => setPacienteEscolhido(p)}
                            className="rounded-lg px-3 py-2 text-left text-sm text-fg hover:bg-surface"
                          >
                            {p.nome} {p.cpf ? `— CPF ${formatarCpf(p.cpf)}` : ""}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {pacienteEscolhido && (
                  <div>
                    <p className="mb-2 text-sm font-medium text-fg">Confira antes de vincular:</p>
                    <div className="mb-4 grid grid-cols-2 gap-4">
                      <div className="rounded-lg border border-border bg-bg p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted">No envio</p>
                        <p className="mt-1 text-sm text-fg">{nomeEnvio}</p>
                        <p className="text-xs text-muted">
                          CPF: {cpfEnvioDigitos ? formatarCpf(cpfEnvioDigitos) : "não informado"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-gold/40 bg-gold/5 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted">Paciente escolhido</p>
                        <p className="mt-1 text-sm text-fg">{pacienteEscolhido.nome}</p>
                        <p className="text-xs text-muted">
                          CPF: {pacienteEscolhido.cpf ? formatarCpf(pacienteEscolhido.cpf) : "não informado"}
                        </p>
                      </div>
                    </div>

                    {cpfEnvioDigitos &&
                      pacienteEscolhido.cpf &&
                      soDigitosCpf(pacienteEscolhido.cpf) !== cpfEnvioDigitos && (
                        <p className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
                          O CPF do envio é diferente do CPF deste paciente — confira com atenção antes de
                          vincular (histórico do projeto já teve caso de CPF de familiar).
                        </p>
                      )}

                    <label className="mb-4 flex items-center gap-2 text-sm text-fg">
                      <input
                        type="checkbox"
                        checked={complementarCadastro}
                        onChange={(e) => setComplementarCadastro(e.target.checked)}
                      />
                      Complementar cadastro do paciente com dados do envio (só preenche campos vazios,
                      nunca substitui valor existente)
                    </label>

                    {erroAcao && <p className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroAcao}</p>}

                    <div className="flex gap-3">
                      <button
                        onClick={() => setPacienteEscolhido(null)}
                        className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg"
                      >
                        Escolher outro
                      </button>
                      <button
                        onClick={confirmarVincular}
                        disabled={enviando}
                        className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {enviando ? "Vinculando..." : "Confirmar vínculo e anexar anamnese"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {acao === "ignorar" && (
              <div>
                <button onClick={() => setAcao(null)} className="mb-4 text-sm text-muted hover:text-fg">
                  ← escolher outra ação
                </button>
                <label className="mb-1 block text-sm font-medium text-fg">Motivo (obrigatório)</label>
                <textarea
                  value={motivoIgnorar}
                  onChange={(e) => setMotivoIgnorar(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
                {erroAcao && <p className="mt-2 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroAcao}</p>}
                <button
                  onClick={confirmarIgnorar}
                  disabled={!motivoIgnorar.trim() || enviando}
                  className="mt-4 rounded-lg bg-red px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {enviando ? "Ignorando..." : "Confirmar ignorar"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
