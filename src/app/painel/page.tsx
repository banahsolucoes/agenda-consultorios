"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  diaSemanaLabel,
  tipoPacoteLabel,
  statusLabel,
  origemCadastroLabel,
} from "@/lib/labels";
import { TIMEZONE } from "@/lib/timezone";
import AgendaCalendario from "./AgendaCalendario";
import DatePickerSP from "./DatePickerSP";

// Opções dos selects do formulário, na mesma ordem dos enums do Prisma
const DIAS_SEMANA = [
  "SEGUNDA",
  "TERCA",
  "QUARTA",
  "QUINTA",
  "SEXTA",
  "SABADO",
  "DOMINGO",
] as const;

const TIPOS_PACOTE = [
  "AVULSA",
  "MENSAL",
  "BIMESTRAL",
  "TRIMESTRAL",
  "PERSONALIZADO",
] as const;

const ORIGEM_CADASTRO_OPCOES = ["MANUAL", "FORMS"] as const;

// Status disponíveis para o operador escolher manualmente numa sessão
const STATUS_SESSAO_OPCOES = [
  "AGENDADA",
  "REAGENDADA",
  "REALIZADA",
  "NAO_REALIZADA",
] as const;

// Sessões nesses status viram registro somente-leitura na tela: nenhum
// controle (menu de status, editar, copiar, seleção para adiar) fica clicável
const STATUS_TRAVADOS = ["REALIZADA", "NAO_REALIZADA", "CANCELADA"];

interface Paciente {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  cpf: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  quemIndicou: string | null;
  origemCadastro: string;
  diaPreferido: string;
  horarioFixo: string;
  tipoSessaoId: string | null;
  statusGeral: "ATIVO" | "CANCELADO" | "FINALIZADO";
}

// Pendências mostradas no sino de notificações
interface NotificacaoSessao {
  id: string;
  numeroSessao: number;
  totalPacote: number;
  inicio: string;
  paciente: { id: string; nome: string };
}
interface NotificacaoPaciente {
  id: string;
  nome: string;
  finalizadoEm: string;
}
interface Notificacoes {
  reagendadas: NotificacaoSessao[];
  finalizados: NotificacaoPaciente[];
}

interface Sessao {
  id: string;
  pacoteId: string;
  pacienteId: string;
  numeroSessao: number;
  totalPacote: number;
  inicio: string;
  duracaoMin: number;
  status: string;
  linkMeet: string | null;
  motivoCancelamento: string | null;
}

interface Clinica {
  nomeAssistente: string;
  horarioLimiteConfirmacao: string;
}

interface TipoSessao {
  id: string;
  nome: string;
}

// Estado inicial do formulário de novo paciente
const FORM_VAZIO = {
  nome: "",
  cpf: "",
  telefone: "",
  email: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  estado: "",
  quemIndicou: "",
  origemCadastro: "MANUAL" as string,
  diaPreferido: DIAS_SEMANA[0] as string,
  horarioFixo: "",
  tipoSessaoId: "",
};

// Aplica máscara 00000-000 ao CEP conforme o usuário digita
function mascararCep(valor: string) {
  const digitos = valor.replace(/\D/g, "").slice(0, 8);
  return digitos.length > 5 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : digitos;
}

// Aplica máscara HH:MM ao horário conforme o usuário digita
function mascararHorario(valor: string) {
  const digitos = valor.replace(/\D/g, "").slice(0, 4);
  return digitos.length > 2 ? `${digitos.slice(0, 2)}:${digitos.slice(2)}` : digitos;
}

// Remove acentos e normaliza para minúsculas, usado no filtro de busca
function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Formata a data/hora da sessão no padrão pt-BR, sempre no fuso de São Paulo
// (independente do fuso do navegador ou do processo que renderizou a página)
function formatarDataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE,
  });
}

// Data curta dd/mm e horário HH:MM, usados nas mensagens de copiar-colar
function formatarDataCurta(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: TIMEZONE });
}
function formatarHorario(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE });
}

// Cor da badge de status (sessão ou paciente/pacote)
function corStatus(status: string) {
  switch (status) {
    case "AGENDADA":
      return "bg-blue/10 text-blue";
    case "REAGENDADA":
      return "bg-orange/10 text-orange";
    case "REALIZADA":
    case "ATIVO":
      return "bg-green/10 text-green";
    case "NAO_REALIZADA":
    case "CANCELADO":
      return "bg-red/10 text-red";
    case "CANCELADA":
    case "FINALIZADO":
      return "bg-muted/10 text-muted";
    default:
      return "bg-muted/10 text-muted";
  }
}

// Cor sólida usada no ponto do menu de status (mesma paleta de corStatus)
function corPontoStatus(status: string) {
  switch (status) {
    case "AGENDADA":
      return "bg-blue";
    case "REAGENDADA":
      return "bg-orange";
    case "REALIZADA":
      return "bg-green";
    case "NAO_REALIZADA":
      return "bg-red";
    default:
      return "bg-muted";
  }
}

// Ícone de lápis (botão Editar)
function IconLapis({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M14.7 2.3a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4L7 15.9l-3.5.6.6-3.5L14.7 2.3Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Ícone de lixeira (excluir paciente)
function IconLixeira({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6M6 6l.6 9.4A1.5 1.5 0 0 0 8.1 17h3.8a1.5 1.5 0 0 0 1.5-1.6L14 6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Ícone de sino (notificações)
function IconSino({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M10 2a4 4 0 0 0-4 4v2.2c0 .6-.2 1.2-.6 1.7L4 12h12l-1.4-2.1a2.8 2.8 0 0 1-.6-1.7V6a4 4 0 0 0-4-4Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M8 15a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

// Menu de status de uma sessão: botão com ponto colorido + opções com ícone/cor
function MenuStatus({
  status,
  disabled,
  onEscolher,
}: {
  status: string;
  disabled?: boolean;
  onEscolher: (novoStatus: string) => void;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setAberto(false);
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAberto((a) => !a)}
        className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-sm text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={`h-2 w-2 rounded-full ${corPontoStatus(status)}`} />
        {statusLabel(status)}
        <span className="text-muted">▾</span>
      </button>
      {aberto && (
        <div className="absolute left-0 z-10 mt-1 w-40 rounded-lg border border-border bg-surface p-1 shadow-lg">
          {STATUS_SESSAO_OPCOES.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => {
                onEscolher(st);
                setAberto(false);
              }}
              className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg ${
                st === status ? "text-gold" : "text-fg"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${corPontoStatus(st)}`} />
              {statusLabel(st)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PainelPage() {
  const router = useRouter();

  const [abaAtiva, setAbaAtiva] = useState<"pacientes" | "agenda">("pacientes");

  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [busca, setBusca] = useState("");
  const [saindo, setSaindo] = useState(false);
  const [clinica, setClinica] = useState<Clinica | null>(null);
  const [tiposSessao, setTiposSessao] = useState<TipoSessao[]>([]);

  // Sino de notificações (sessões reagendadas + pacientes finalizados)
  const [notificacoes, setNotificacoes] = useState<Notificacoes>({ reagendadas: [], finalizados: [] });
  const [sinoAberto, setSinoAberto] = useState(false);

  const [modalAberto, setModalAberto] = useState(false);
  const [pacienteEditando, setPacienteEditando] = useState<Paciente | null>(null);
  const [form, setForm] = useState(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState("");

  // Paciente selecionado (abre o painel lateral de sessões) e suas sessões
  const [pacienteSelecionado, setPacienteSelecionado] = useState<Paciente | null>(null);
  const [sessoes, setSessoes] = useState<Sessao[]>([]);
  const [carregandoSessoes, setCarregandoSessoes] = useState(false);
  const [statusSalvandoId, setStatusSalvandoId] = useState<string | null>(null);
  const [copiadoId, setCopiadoId] = useState<string | null>(null);

  // Modal: criar atendimento
  const [modalPacote, setModalPacote] = useState(false);
  const [tipoPacote, setTipoPacote] = useState<string>(TIPOS_PACOTE[0]);
  const [totalPacote, setTotalPacote] = useState("");
  const [dataInicialPacote, setDataInicialPacote] = useState("");
  const [horarioPacote, setHorarioPacote] = useState("");
  const [salvandoPacote, setSalvandoPacote] = useState(false);
  const [erroPacote, setErroPacote] = useState("");

  // Modal: editar sessão pontual (novo dia + novo horário)
  const [sessaoEditando, setSessaoEditando] = useState<Sessao | null>(null);
  const [formEditar, setFormEditar] = useState({ novoDia: DIAS_SEMANA[0] as string, novoHorario: "" });
  const [salvandoEditar, setSalvandoEditar] = useState(false);
  const [erroEditar, setErroEditar] = useState("");

  // Modal: empurrar sessões futuras em N semanas
  const [modalEmpurrar, setModalEmpurrar] = useState(false);
  const [semanasEmpurrar, setSemanasEmpurrar] = useState("1");
  const [mudarDiaHorario, setMudarDiaHorario] = useState(false);
  const [novoDiaEmpurrar, setNovoDiaEmpurrar] = useState<string>(DIAS_SEMANA[0]);
  const [novoHorarioEmpurrar, setNovoHorarioEmpurrar] = useState("");
  const [salvandoEmpurrar, setSalvandoEmpurrar] = useState(false);
  const [erroEmpurrar, setErroEmpurrar] = useState("");

  // Modal: adiar sessões a partir de uma sessão de corte
  const [modalAdiar, setModalAdiar] = useState(false);
  const [sessaoCorteId, setSessaoCorteId] = useState("");
  const [salvandoAdiar, setSalvandoAdiar] = useState(false);
  const [erroAdiar, setErroAdiar] = useState("");

  // Modal: cancelar sessão com motivo obrigatório
  const [sessaoCancelando, setSessaoCancelando] = useState<Sessao | null>(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState("");
  const [salvandoCancelar, setSalvandoCancelar] = useState(false);
  const [erroCancelar, setErroCancelar] = useState("");

  // Modal: excluir paciente — trava exige digitar o nome do paciente
  const [pacienteExcluindo, setPacienteExcluindo] = useState<Paciente | null>(null);
  const [confirmacaoExclusao, setConfirmacaoExclusao] = useState("");
  const [salvandoExclusao, setSalvandoExclusao] = useState(false);
  const [erroExclusao, setErroExclusao] = useState("");

  // Busca a lista de pacientes da clínica logada
  async function carregarPacientes() {
    setCarregandoLista(true);
    try {
      const res = await fetch("/api/pacientes");
      if (res.ok) {
        setPacientes(await res.json());
      }
    } finally {
      setCarregandoLista(false);
    }
  }

  // Recarrega a lista de pacientes e sincroniza o paciente aberto no painel lateral
  // (o statusGeral dele pode mudar sozinho: pacote finalizado, renovação, etc.)
  async function recarregarPacienteSelecionado() {
    const res = await fetch("/api/pacientes");
    if (!res.ok) return;
    const lista: Paciente[] = await res.json();
    setPacientes(lista);
    setPacienteSelecionado((atual) => (atual ? lista.find((p) => p.id === atual.id) ?? atual : atual));
  }

  async function carregarClinica() {
    const res = await fetch("/api/clinica");
    if (res.ok) setClinica(await res.json());
  }

  async function carregarTiposSessao() {
    const res = await fetch("/api/clinica/tipos-sessao");
    if (res.ok) setTiposSessao(await res.json());
  }

  // Busca as pendências do sino (chamada de novo após qualquer operação que possa mudar status)
  async function carregarNotificacoes() {
    const res = await fetch("/api/notificacoes");
    if (res.ok) setNotificacoes(await res.json());
  }

  useEffect(() => {
    carregarPacientes();
    carregarClinica();
    carregarTiposSessao();
    carregarNotificacoes();
  }, []);

  // Lista filtrada por nome, ignorando maiúsculas/minúsculas e acentos
  const pacientesFiltrados = useMemo(() => {
    const termo = normalizar(busca.trim());
    if (!termo) return pacientes;
    return pacientes.filter((p) => normalizar(p.nome).includes(termo));
  }, [pacientes, busca]);

  const totalPendencias = notificacoes.reagendadas.length + notificacoes.finalizados.length;

  function abrirModal() {
    setPacienteEditando(null);
    setForm({ ...FORM_VAZIO, tipoSessaoId: tiposSessao[0]?.id ?? "" });
    setErroForm("");
    setModalAberto(true);
  }

  // Abre o mesmo modal preenchido com os dados do paciente, para edição de cadastro
  function abrirModalEdicao(p: Paciente) {
    setPacienteEditando(p);
    setForm({
      nome: p.nome,
      cpf: p.cpf ?? "",
      telefone: p.telefone ?? "",
      email: p.email ?? "",
      cep: p.cep ?? "",
      logradouro: p.logradouro ?? "",
      numero: p.numero ?? "",
      complemento: p.complemento ?? "",
      bairro: p.bairro ?? "",
      cidade: p.cidade ?? "",
      estado: p.estado ?? "",
      quemIndicou: p.quemIndicou ?? "",
      origemCadastro: p.origemCadastro,
      diaPreferido: p.diaPreferido,
      horarioFixo: p.horarioFixo,
      tipoSessaoId: p.tipoSessaoId ?? "",
    });
    setErroForm("");
    setModalAberto(true);
  }

  function fecharModal() {
    if (salvando) return;
    setModalAberto(false);
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target;
    const valorFinal = name === "cep" ? mascararCep(value) : value;
    setForm((f) => ({ ...f, [name]: valorFinal }));
  }

  async function handleSalvar(e: React.FormEvent) {
    e.preventDefault();
    setErroForm("");
    setSalvando(true);

    try {
      const url = pacienteEditando ? `/api/pacientes/${pacienteEditando.id}` : "/api/pacientes";
      const method = pacienteEditando ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErroForm(data?.erro ?? "não foi possível salvar o paciente");
        return;
      }

      setModalAberto(false);
      await recarregarPacienteSelecionado();
    } catch {
      setErroForm("não foi possível salvar o paciente");
    } finally {
      setSalvando(false);
    }
  }

  async function handleSair() {
    setSaindo(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
    }
  }

  // Busca as sessões do paciente selecionado
  async function carregarSessoes(pacienteId: string) {
    setCarregandoSessoes(true);
    try {
      const res = await fetch(`/api/agendamentos?pacienteId=${pacienteId}`);
      if (res.ok) {
        setSessoes(await res.json());
      }
    } finally {
      setCarregandoSessoes(false);
    }
  }

  function abrirPainelPaciente(p: Paciente) {
    setPacienteSelecionado(p);
    setSessoes([]);
    carregarSessoes(p.id);
  }

  function fecharPainelPaciente() {
    setPacienteSelecionado(null);
    setSessoes([]);
  }

  // Ao clicar numa pendência do sino, fecha o dropdown e abre o painel do paciente
  function abrirNotificacaoPaciente(pacienteId: string) {
    setSinoAberto(false);
    const p = pacientes.find((pac) => pac.id === pacienteId);
    if (p) abrirPainelPaciente(p);
  }

  // Criação de atendimento (só aparece quando o paciente ainda não tem sessões)
  function abrirModalPacote() {
    setTipoPacote(TIPOS_PACOTE[0]);
    setTotalPacote("");
    setDataInicialPacote("");
    setHorarioPacote("");
    setErroPacote("");
    setModalPacote(true);
  }

  async function handleCriarPacote(e: React.FormEvent) {
    e.preventDefault();
    if (!pacienteSelecionado) return;
    setErroPacote("");
    setSalvandoPacote(true);

    try {
      const body: Record<string, unknown> = {
        pacienteId: pacienteSelecionado.id,
        tipo: tipoPacote,
      };
      if (tipoPacote === "PERSONALIZADO") {
        body.totalSessoes = Number(totalPacote);
      }
      if (dataInicialPacote) body.dataInicial = dataInicialPacote;
      if (horarioPacote) body.horario = horarioPacote;

      const res = await fetch("/api/pacotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErroPacote(data?.erro ?? "não foi possível criar o atendimento");
        return;
      }

      setModalPacote(false);
      await carregarSessoes(pacienteSelecionado.id);
      await recarregarPacienteSelecionado();
      await carregarNotificacoes();
    } catch {
      setErroPacote("não foi possível criar o atendimento");
    } finally {
      setSalvandoPacote(false);
    }
  }

  // Troca de status de uma sessão via dropdown
  async function handleMudarStatus(sessaoId: string, novoStatus: string) {
    if (!pacienteSelecionado) return;
    setStatusSalvandoId(sessaoId);
    try {
      const res = await fetch(`/api/sessoes/${sessaoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: novoStatus }),
      });
      if (res.ok) {
        await carregarSessoes(pacienteSelecionado.id);
        await recarregarPacienteSelecionado();
        await carregarNotificacoes();
      }
    } finally {
      setStatusSalvandoId(null);
    }
  }

  // Edição pontual de dia/horário de uma sessão
  function abrirModalEditar(s: Sessao) {
    setSessaoEditando(s);
    setFormEditar({ novoDia: DIAS_SEMANA[0], novoHorario: "" });
    setErroEditar("");
  }

  async function handleSalvarEdicao(e: React.FormEvent) {
    e.preventDefault();
    if (!sessaoEditando || !pacienteSelecionado) return;
    setErroEditar("");
    setSalvandoEditar(true);

    try {
      const res = await fetch(`/api/sessoes/${sessaoEditando.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formEditar),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErroEditar(data?.erro ?? "não foi possível editar a sessão");
        return;
      }

      setSessaoEditando(null);
      await carregarSessoes(pacienteSelecionado.id);
      await carregarNotificacoes();
    } catch {
      setErroEditar("não foi possível editar a sessão");
    } finally {
      setSalvandoEditar(false);
    }
  }

  // Empurrar todas as sessões futuras em N semanas
  function abrirModalEmpurrar() {
    setSemanasEmpurrar("1");
    setMudarDiaHorario(false);
    setNovoDiaEmpurrar(DIAS_SEMANA[0]);
    setNovoHorarioEmpurrar("");
    setErroEmpurrar("");
    setModalEmpurrar(true);
  }

  async function handleSalvarEmpurrar(e: React.FormEvent) {
    e.preventDefault();
    if (!pacienteSelecionado) return;
    setErroEmpurrar("");
    setSalvandoEmpurrar(true);

    try {
      const body: Record<string, unknown> = { semanas: Number(semanasEmpurrar) };
      if (mudarDiaHorario) {
        body.novoDia = novoDiaEmpurrar;
        body.novoHorario = novoHorarioEmpurrar;
      }

      const res = await fetch(`/api/pacientes/${pacienteSelecionado.id}/empurrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErroEmpurrar(data?.erro ?? "não foi possível empurrar as sessões");
        return;
      }

      setModalEmpurrar(false);
      await carregarSessoes(pacienteSelecionado.id);
      await carregarNotificacoes();
    } catch {
      setErroEmpurrar("não foi possível empurrar as sessões");
    } finally {
      setSalvandoEmpurrar(false);
    }
  }

  // Adiar sessões a partir de uma sessão de corte escolhida
  function abrirModalAdiar() {
    const primeiraDisponivel = sessoes.find((s) => !STATUS_TRAVADOS.includes(s.status));
    setSessaoCorteId(primeiraDisponivel?.id ?? "");
    setErroAdiar("");
    setModalAdiar(true);
  }

  async function handleSalvarAdiar(e: React.FormEvent) {
    e.preventDefault();
    if (!pacienteSelecionado || !sessaoCorteId) return;
    setErroAdiar("");
    setSalvandoAdiar(true);

    try {
      const res = await fetch(`/api/pacientes/${pacienteSelecionado.id}/adiar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessaoCorteId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErroAdiar(data?.erro ?? "não foi possível adiar as sessões");
        return;
      }

      setModalAdiar(false);
      await carregarSessoes(pacienteSelecionado.id);
      await carregarNotificacoes();
    } catch {
      setErroAdiar("não foi possível adiar as sessões");
    } finally {
      setSalvandoAdiar(false);
    }
  }

  // Cancelamento de sessão com motivo obrigatório
  function abrirModalCancelar(s: Sessao) {
    setSessaoCancelando(s);
    setMotivoCancelamento("");
    setErroCancelar("");
  }

  async function handleConfirmarCancelamento(e: React.FormEvent) {
    e.preventDefault();
    if (!sessaoCancelando || !pacienteSelecionado) return;
    const motivo = motivoCancelamento.trim();
    if (!motivo) {
      setErroCancelar("informe o motivo do cancelamento");
      return;
    }
    setErroCancelar("");
    setSalvandoCancelar(true);

    try {
      const res = await fetch(`/api/sessoes/${sessaoCancelando.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELADA", motivoCancelamento: motivo }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErroCancelar(data?.erro ?? "não foi possível cancelar a sessão");
        return;
      }

      setSessaoCancelando(null);
      await carregarSessoes(pacienteSelecionado.id);
      await recarregarPacienteSelecionado();
      await carregarNotificacoes();
    } catch {
      setErroCancelar("não foi possível cancelar a sessão");
    } finally {
      setSalvandoCancelar(false);
    }
  }

  // Exclusão definitiva de paciente — trava exige digitar o nome do paciente
  function abrirModalExcluir(p: Paciente) {
    setPacienteExcluindo(p);
    setConfirmacaoExclusao("");
    setErroExclusao("");
  }

  async function handleConfirmarExclusao(e: React.FormEvent) {
    e.preventDefault();
    if (!pacienteExcluindo) return;
    setErroExclusao("");
    setSalvandoExclusao(true);

    try {
      const res = await fetch(`/api/pacientes/${pacienteExcluindo.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErroExclusao(data?.erro ?? "não foi possível excluir o paciente");
        return;
      }

      setPacienteExcluindo(null);
      fecharPainelPaciente();
      await carregarPacientes();
    } catch {
      setErroExclusao("não foi possível excluir o paciente");
    } finally {
      setSalvandoExclusao(false);
    }
  }

  // Monta a mensagem de confirmação de sessão, pronta para copiar e colar
  function montarMensagemConfirmacao(s: Sessao) {
    if (!pacienteSelecionado || !clinica) return "";
    const primeiroNome = pacienteSelecionado.nome.split(" ")[0];
    return (
      `Olá, ${primeiroNome}! Passando para confirmar sua sessão no dia ${formatarDataCurta(s.inicio)} às ${formatarHorario(s.inicio)}. ` +
      `Caso precise remarcar, nos avise até às ${clinica.horarioLimiteConfirmacao}. Até lá!\n— ${clinica.nomeAssistente}`
    );
  }

  // Monta a mensagem com o link do Meet, pronta para copiar e colar
  function montarMensagemMeet(s: Sessao) {
    if (!pacienteSelecionado || !clinica) return "";
    const primeiroNome = pacienteSelecionado.nome.split(" ")[0];
    const link = s.linkMeet ?? "(link ainda não gerado)";
    return (
      `Olá, ${primeiroNome}! Sua sessão é no dia ${formatarDataCurta(s.inicio)} às ${formatarHorario(s.inicio)}. ` +
      `Link de acesso: ${link}\n` +
      `Caso precise remarcar, nos avise até às ${clinica.horarioLimiteConfirmacao}.\n— ${clinica.nomeAssistente}`
    );
  }

  async function copiar(texto: string, chave: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiadoId(chave);
      setTimeout(() => setCopiadoId((atual) => (atual === chave ? null : atual)), 2000);
    } catch {
      // clipboard indisponível (ex.: contexto não seguro) — falha silenciosa
    }
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Cabeçalho */}
      <header className="sticky top-0 z-30 h-16 border-b border-border bg-surface">
        <div className="mx-auto flex h-full max-w-5xl items-center justify-between px-6">
          <h1 className="font-serif text-lg font-semibold text-fg">
            Agenda Consultórios
          </h1>
          <div className="flex items-center gap-2">
            {/* Sino de notificações: sessões reagendadas + pacientes finalizados */}
            <div
              className="relative"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setSinoAberto(false);
              }}
            >
              <button
                onClick={() => setSinoAberto((a) => !a)}
                className="relative rounded-lg border border-border p-2 text-fg hover:bg-bg"
                aria-label="Notificações"
              >
                <IconSino className="h-5 w-5" />
                {totalPendencias > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red px-1 text-[10px] font-semibold text-white">
                    {totalPendencias}
                  </span>
                )}
              </button>
              {sinoAberto && (
                <div className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] rounded-xl border border-border bg-surface p-3 shadow-lg">
                  <p className="mb-2 text-sm font-semibold text-fg">Pendências</p>
                  {totalPendencias === 0 ? (
                    <p className="text-sm text-muted">Nenhuma pendência no momento.</p>
                  ) : (
                    <div className="max-h-80 space-y-3 overflow-y-auto">
                      {notificacoes.reagendadas.length > 0 && (
                        <div>
                          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                            Sessões reagendadas
                          </p>
                          <ul className="space-y-1">
                            {notificacoes.reagendadas.map((n) => (
                              <li key={n.id}>
                                <button
                                  onClick={() => abrirNotificacaoPaciente(n.paciente.id)}
                                  className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-fg hover:bg-bg"
                                >
                                  <span className="font-medium">{n.paciente.nome}</span> — sessão{" "}
                                  {n.numeroSessao}/{n.totalPacote} em {formatarDataHora(n.inicio)}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {notificacoes.finalizados.length > 0 && (
                        <div>
                          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                            Renovação pendente
                          </p>
                          <ul className="space-y-1">
                            {notificacoes.finalizados.map((p) => (
                              <li key={p.id}>
                                <button
                                  onClick={() => abrirNotificacaoPaciente(p.id)}
                                  className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-fg hover:bg-bg"
                                >
                                  <span className="font-medium">{p.nome}</span> — finalizado em{" "}
                                  {formatarDataCurta(p.finalizadoEm)}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() => router.push("/painel/configuracoes")}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg"
            >
              Configurações
            </button>
            <button
              onClick={handleSair}
              disabled={saindo}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saindo ? "Saindo..." : "Sair"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* Abas: lista de pacientes ou calendário da agenda */}
        <div className="mb-6 flex gap-2">
          <button
            onClick={() => setAbaAtiva("pacientes")}
            className={`rounded-lg border px-4 py-2 text-sm font-medium ${
              abaAtiva === "pacientes" ? "border-gold bg-gold/10 text-gold" : "border-border text-fg hover:bg-bg"
            }`}
          >
            Pacientes
          </button>
          <button
            onClick={() => setAbaAtiva("agenda")}
            className={`rounded-lg border px-4 py-2 text-sm font-medium ${
              abaAtiva === "agenda" ? "border-gold bg-gold/10 text-gold" : "border-border text-fg hover:bg-bg"
            }`}
          >
            Agenda
          </button>
        </div>

        {abaAtiva === "agenda" ? (
          <AgendaCalendario />
        ) : (
          <>
            {/* Barra de busca + ação de novo paciente */}
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar paciente por nome..."
                className="w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-2 text-fg outline-none placeholder:text-muted focus:border-gold focus:ring-2 focus:ring-gold/20"
              />
              <button
                onClick={abrirModal}
                className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110"
              >
                + Novo paciente
              </button>
            </div>

            {/* Lista de pacientes */}
            {carregandoLista ? (
              <p className="text-sm text-muted">Carregando pacientes...</p>
            ) : pacientesFiltrados.length === 0 ? (
              <p className="text-sm text-muted">
                Nenhum paciente encontrado.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pacientesFiltrados.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => abrirPainelPaciente(p)}
                    className="rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition-shadow hover:shadow-md hover:border-gold/40"
                  >
                    <p className="font-medium text-fg">{p.nome}</p>
                    <p className="mt-1 text-sm text-muted">
                      {p.telefone ?? "sem telefone"}
                    </p>
                    <span className={`mt-3 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${corStatus(p.statusGeral)}`}>
                      {statusLabel(p.statusGeral)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Modal de cadastro de paciente */}
      {modalAberto && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-serif text-lg font-semibold text-fg">
                {pacienteEditando ? "Editar paciente" : "Novo paciente"}
              </h2>
              <button
                onClick={fecharModal}
                className="text-muted hover:text-fg"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSalvar} className="space-y-6">
              {/* Dados pessoais */}
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gold">
                  Dados pessoais
                </h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Campo label="Nome" name="nome" value={form.nome} onChange={handleChange} required className="sm:col-span-2" />
                  <Campo label="CPF" name="cpf" value={form.cpf} onChange={handleChange} />
                  <Campo label="Telefone" name="telefone" value={form.telefone} onChange={handleChange} />
                  <Campo label="E-mail" name="email" value={form.email} onChange={handleChange} type="email" className="sm:col-span-2" />
                  <Campo label="Quem indicou" name="quemIndicou" value={form.quemIndicou} onChange={handleChange} />
                  <div>
                    <label className="mb-1 block text-sm font-medium text-fg">
                      Origem do cadastro
                    </label>
                    <select
                      name="origemCadastro"
                      value={form.origemCadastro}
                      onChange={handleChange}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                    >
                      {ORIGEM_CADASTRO_OPCOES.map((origem) => (
                        <option key={origem} value={origem}>
                          {origemCadastroLabel(origem)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Endereço */}
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gold">
                  Endereço
                </h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Campo label="CEP" name="cep" value={form.cep} onChange={handleChange} placeholder="00000-000" />
                  <Campo label="Logradouro" name="logradouro" value={form.logradouro} onChange={handleChange} />
                  <Campo label="Número" name="numero" value={form.numero} onChange={handleChange} />
                  <Campo label="Complemento" name="complemento" value={form.complemento} onChange={handleChange} />
                  <Campo label="Bairro" name="bairro" value={form.bairro} onChange={handleChange} />
                  <Campo label="Cidade" name="cidade" value={form.cidade} onChange={handleChange} />
                  <Campo label="Estado" name="estado" value={form.estado} onChange={handleChange} />
                </div>
              </div>

              {/* Atendimento */}
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gold">
                  Atendimento
                </h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-fg">
                      Dia preferido
                    </label>
                    <select
                      name="diaPreferido"
                      value={form.diaPreferido}
                      onChange={handleChange}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                    >
                      {DIAS_SEMANA.map((dia) => (
                        <option key={dia} value={dia}>
                          {diaSemanaLabel(dia)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <Campo
                    label="Horário fixo (HH:MM)"
                    name="horarioFixo"
                    value={form.horarioFixo}
                    onChange={handleChange}
                    required
                    placeholder="14:00"
                    pattern="^([01]\d|2[0-3]):[0-5]\d$"
                  />

                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-fg">
                      Tipo de sessão
                    </label>
                    {tiposSessao.length === 0 ? (
                      <p className="text-sm text-muted">
                        Nenhum tipo de sessão cadastrado. Configure em Configurações → Tipos de sessão.
                      </p>
                    ) : (
                      <select
                        name="tipoSessaoId"
                        value={form.tipoSessaoId}
                        onChange={handleChange}
                        required
                        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                      >
                        {tiposSessao.map((tipo) => (
                          <option key={tipo.id} value={tipo.id}>
                            {tipo.nome}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              </div>

              {erroForm && (
                <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
                  {erroForm}
                </p>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={fecharModal}
                  disabled={salvando}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando || tiposSessao.length === 0}
                  className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvando ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Painel lateral de sessões do paciente selecionado */}
      {pacienteSelecionado && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-40 flex justify-end bg-black/60">
          <div
            className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-surface p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="font-serif text-lg font-semibold text-fg">
                  {pacienteSelecionado.nome}
                </h2>
                <p className="text-sm text-muted">
                  {pacienteSelecionado.telefone ?? "sem telefone"}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {tiposSessao.find((t) => t.id === pacienteSelecionado.tipoSessaoId) && (
                    <span className="rounded-full bg-gold/10 px-2 py-0.5 text-xs font-medium text-gold">
                      {tiposSessao.find((t) => t.id === pacienteSelecionado.tipoSessaoId)?.nome}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${corStatus(pacienteSelecionado.statusGeral)}`}
                  >
                    {statusLabel(pacienteSelecionado.statusGeral)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => abrirModalEdicao(pacienteSelecionado)}
                  className="text-muted hover:text-fg"
                  aria-label="Editar cadastro"
                  title="Editar cadastro"
                >
                  <IconLapis className="h-4 w-4" />
                </button>
                <button
                  onClick={() => abrirModalExcluir(pacienteSelecionado)}
                  className="text-muted hover:text-red"
                  aria-label="Excluir paciente"
                  title="Excluir paciente"
                >
                  <IconLixeira className="h-4 w-4" />
                </button>
                <button
                  onClick={fecharPainelPaciente}
                  className="text-muted hover:text-fg"
                  aria-label="Fechar"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Ações gerais do paciente — Criar atendimento fica sempre visível,
                mesmo com sessões já geradas, para permitir novos atendimentos
                a qualquer momento */}
            <div className="mb-4 flex flex-wrap gap-2">
              <button
                onClick={abrirModalPacote}
                className="rounded-lg bg-gold px-3 py-1.5 text-sm font-medium text-bg hover:brightness-110"
              >
                Criar atendimento
              </button>
              {sessoes.length > 0 && (
                <>
                  <button
                    onClick={abrirModalEmpurrar}
                    className="rounded-lg border border-blue px-3 py-1.5 text-sm font-medium text-blue hover:bg-blue/10"
                  >
                    Empurrar
                  </button>
                  <button
                    onClick={abrirModalAdiar}
                    className="rounded-lg border border-orange px-3 py-1.5 text-sm font-medium text-orange hover:bg-orange/10"
                  >
                    Adiar
                  </button>
                </>
              )}
            </div>

            {/* Atendimento finalizado: histórico continua visível, mas cabe renovar */}
            {sessoes.length > 0 && pacienteSelecionado.statusGeral === "FINALIZADO" && (
              <div className="mb-6 rounded-lg border border-dashed border-gold/40 bg-gold/5 p-3">
                <p className="mb-2 text-sm text-fg">
                  O atendimento deste paciente foi finalizado. Renovar cria um atendimento novo.
                </p>
                <button
                  onClick={abrirModalPacote}
                  className="rounded-lg bg-gold px-3 py-1.5 text-sm font-medium text-bg hover:brightness-110"
                >
                  Renovar atendimento
                </button>
              </div>
            )}

            {/* Lista de sessões ou criação de atendimento */}
            {carregandoSessoes ? (
              <p className="text-sm text-muted">Carregando sessões...</p>
            ) : sessoes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-center">
                <p className="text-sm text-muted">
                  Este paciente ainda não tem sessões.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {sessoes.map((s) => {
                  const travada = STATUS_TRAVADOS.includes(s.status);
                  return (
                  <li
                    key={s.id}
                    className={`rounded-lg border border-border p-3 ${travada ? "opacity-70" : ""}`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-fg">
                          Sessão {s.numeroSessao}/{s.totalPacote}
                        </p>
                        <p className="text-sm text-muted">
                          {formatarDataHora(s.inicio)}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${corStatus(s.status)}`}
                      >
                        {statusLabel(s.status)}
                      </span>
                    </div>

                    {s.status === "CANCELADA" && s.motivoCancelamento && (
                      <p
                        className="mt-1 text-xs italic text-muted"
                        title={s.motivoCancelamento}
                      >
                        Motivo: {s.motivoCancelamento}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <MenuStatus
                        status={s.status}
                        disabled={statusSalvandoId === s.id || travada}
                        onEscolher={(novoStatus) => handleMudarStatus(s.id, novoStatus)}
                      />
                      <button
                        onClick={() => abrirModalEditar(s)}
                        disabled={travada}
                        title={travada ? "Sessão consumida — somente leitura" : "Editar dia e horário"}
                        className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-sm text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <IconLapis className="h-3.5 w-3.5" />
                        Editar
                      </button>
                      {!travada && (
                        <button
                          onClick={() => abrirModalCancelar(s)}
                          className="rounded-lg border border-red px-2 py-1 text-sm text-red hover:bg-red/10"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>

                    {/* Mensagens de copiar-colar */}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => copiar(montarMensagemConfirmacao(s), `${s.id}-conf`)}
                        disabled={travada}
                        title={travada ? "Sessão consumida — somente leitura" : undefined}
                        className="rounded-lg border border-whatsapp px-2 py-1 text-sm text-whatsapp hover:bg-whatsapp/10 disabled:cursor-not-allowed disabled:border-border disabled:text-muted disabled:opacity-40 disabled:hover:bg-transparent"
                      >
                        {copiadoId === `${s.id}-conf` ? "Copiado!" : "Copiar confirmação"}
                      </button>
                      <button
                        onClick={() => copiar(montarMensagemMeet(s), `${s.id}-meet`)}
                        disabled={travada}
                        title={travada ? "Sessão consumida — somente leitura" : undefined}
                        className="rounded-lg border border-whatsapp px-2 py-1 text-sm text-whatsapp hover:bg-whatsapp/10 disabled:cursor-not-allowed disabled:border-border disabled:text-muted disabled:opacity-40 disabled:hover:bg-transparent"
                      >
                        {copiadoId === `${s.id}-meet` ? "Copiado!" : "Copiar link Meet"}
                      </button>
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Modal: criar atendimento */}
      {modalPacote && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">
              Criar atendimento
            </h2>
            <form onSubmit={handleCriarPacote} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">
                  Tipo de atendimento
                </label>
                <select
                  value={tipoPacote}
                  onChange={(e) => setTipoPacote(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                >
                  {TIPOS_PACOTE.map((t) => (
                    <option key={t} value={t}>
                      {tipoPacoteLabel(t)}
                    </option>
                  ))}
                </select>
              </div>

              {tipoPacote === "PERSONALIZADO" && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">
                    Total de sessões
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={totalPacote}
                    onChange={(e) => setTotalPacote(e.target.value)}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">
                    Dia da 1ª sessão (opcional)
                  </label>
                  <DatePickerSP value={dataInicialPacote} onChange={setDataInicialPacote} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">
                    Horário (opcional)
                  </label>
                  <input
                    type="text"
                    placeholder="14:00"
                    pattern="^([01]\d|2[0-3]):[0-5]\d$"
                    value={horarioPacote}
                    onChange={(e) => setHorarioPacote(mascararHorario(e.target.value))}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  />
                </div>
              </div>
              <p className="text-xs text-muted">
                Deixe em branco para usar o dia preferido e o horário fixo cadastrados no paciente.
              </p>

              {erroPacote && (
                <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
                  {erroPacote}
                </p>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalPacote(false)}
                  disabled={salvandoPacote}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoPacote}
                  className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvandoPacote ? "Criando..." : "Criar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: editar sessão pontual */}
      {sessaoEditando && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">
              Editar sessão {sessaoEditando.numeroSessao}
            </h2>
            <form onSubmit={handleSalvarEdicao} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">
                  Novo dia (mesma semana)
                </label>
                <select
                  value={formEditar.novoDia}
                  onChange={(e) => setFormEditar((f) => ({ ...f, novoDia: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                >
                  {DIAS_SEMANA.map((dia) => (
                    <option key={dia} value={dia}>
                      {diaSemanaLabel(dia)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">
                  Novo horário (HH:MM)
                </label>
                <input
                  type="text"
                  required
                  placeholder="14:00"
                  pattern="^([01]\d|2[0-3]):[0-5]\d$"
                  value={formEditar.novoHorario}
                  onChange={(e) => setFormEditar((f) => ({ ...f, novoHorario: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>

              {erroEditar && (
                <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
                  {erroEditar}
                </p>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSessaoEditando(null)}
                  disabled={salvandoEditar}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoEditar}
                  className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvandoEditar ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: cancelar sessão com motivo obrigatório */}
      {sessaoCancelando && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">
              Cancelar sessão {sessaoCancelando.numeroSessao}
            </h2>
            <form onSubmit={handleConfirmarCancelamento} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">
                  Motivo do cancelamento
                </label>
                <textarea
                  required
                  rows={3}
                  value={motivoCancelamento}
                  onChange={(e) => setMotivoCancelamento(e.target.value)}
                  placeholder="Descreva o motivo do cancelamento..."
                  className="w-full resize-none rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none placeholder:text-muted focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>

              {erroCancelar && (
                <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
                  {erroCancelar}
                </p>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSessaoCancelando(null)}
                  disabled={salvandoCancelar}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={salvandoCancelar || !motivoCancelamento.trim()}
                  className="rounded-lg bg-red px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvandoCancelar ? "Cancelando..." : "Confirmar cancelamento"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: excluir paciente — trava exige digitar o nome do paciente */}
      {pacienteExcluindo && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">
              Excluir {pacienteExcluindo.nome}
            </h2>
            <p className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
              Esta ação é irreversível. Todos os atendimentos, sessões e o histórico deste
              paciente serão apagados permanentemente.
            </p>
            <form onSubmit={handleConfirmarExclusao} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">
                  Para confirmar, digite o nome completo do paciente
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  value={confirmacaoExclusao}
                  onChange={(e) => setConfirmacaoExclusao(e.target.value)}
                  placeholder={pacienteExcluindo.nome}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-red focus:ring-2 focus:ring-red/20"
                />
              </div>

              {erroExclusao && (
                <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
                  {erroExclusao}
                </p>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPacienteExcluindo(null)}
                  disabled={salvandoExclusao}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={
                    salvandoExclusao ||
                    confirmacaoExclusao.trim().toLowerCase() !== pacienteExcluindo.nome.trim().toLowerCase()
                  }
                  className="rounded-lg bg-red px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvandoExclusao ? "Excluindo..." : "Excluir definitivamente"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: empurrar sessões futuras */}
      {modalEmpurrar && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">
              Empurrar sessões
            </h2>
            <form onSubmit={handleSalvarEmpurrar} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">
                  Número de semanas (0-10)
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSemanasEmpurrar((s) => String(Math.max(0, Number(s) - 1)))}
                    disabled={Number(semanasEmpurrar) <= 0}
                    aria-label="Diminuir"
                    className="h-9 w-9 rounded-lg border border-border text-lg text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-lg font-medium text-fg">
                    {semanasEmpurrar}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSemanasEmpurrar((s) => String(Math.min(10, Number(s) + 1)))}
                    disabled={Number(semanasEmpurrar) >= 10}
                    aria-label="Aumentar"
                    className="h-9 w-9 rounded-lg border border-border text-lg text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Toggle: também trocar o dia da semana e o horário */}
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">
                  Deseja mudar o dia da semana e horário?
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMudarDiaHorario(false)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                      !mudarDiaHorario
                        ? "border-gold bg-gold/10 text-gold"
                        : "border-border text-fg hover:bg-bg"
                    }`}
                  >
                    Não
                  </button>
                  <button
                    type="button"
                    onClick={() => setMudarDiaHorario(true)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                      mudarDiaHorario
                        ? "border-gold bg-gold/10 text-gold"
                        : "border-border text-fg hover:bg-bg"
                    }`}
                  >
                    Sim
                  </button>
                </div>
              </div>

              {mudarDiaHorario && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-fg">
                      Novo dia
                    </label>
                    <select
                      value={novoDiaEmpurrar}
                      onChange={(e) => setNovoDiaEmpurrar(e.target.value)}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                    >
                      {DIAS_SEMANA.map((dia) => (
                        <option key={dia} value={dia}>
                          {diaSemanaLabel(dia)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-fg">
                      Novo horário (HH:MM)
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="14:00"
                      pattern="^([01]\d|2[0-3]):[0-5]\d$"
                      value={novoHorarioEmpurrar}
                      onChange={(e) => setNovoHorarioEmpurrar(mascararHorario(e.target.value))}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                    />
                  </div>
                </div>
              )}

              {erroEmpurrar && (
                <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
                  {erroEmpurrar}
                </p>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalEmpurrar(false)}
                  disabled={salvandoEmpurrar}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoEmpurrar}
                  className="rounded-lg bg-green px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvandoEmpurrar ? "Confirmando..." : "Confirmar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: adiar sessões a partir de uma sessão de corte */}
      {modalAdiar && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">
              Adiar sessões
            </h2>
            <form onSubmit={handleSalvarAdiar} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">
                  A partir da sessão
                </label>
                <select
                  value={sessaoCorteId}
                  onChange={(e) => setSessaoCorteId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                >
                  {sessoes.map((s) => (
                    <option key={s.id} value={s.id} disabled={STATUS_TRAVADOS.includes(s.status)}>
                      Sessão {s.numeroSessao}/{s.totalPacote} — {formatarDataHora(s.inicio)}
                      {STATUS_TRAVADOS.includes(s.status) ? ` (${statusLabel(s.status)})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {erroAdiar && (
                <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
                  {erroAdiar}
                </p>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalAdiar(false)}
                  disabled={salvandoAdiar}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoAdiar}
                  className="rounded-lg bg-orange px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvandoAdiar ? "Adiando..." : "Adiar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Campo de texto reutilizável do formulário de paciente
function Campo({
  label,
  name,
  value,
  onChange,
  type = "text",
  required = false,
  placeholder,
  pattern,
  className = "",
}: {
  label: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  pattern?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-sm font-medium text-fg">
        {label}
      </label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        pattern={pattern}
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
      />
    </div>
  );
}
