"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  diaSemanaLabel,
  tipoPacoteLabel,
  statusLabel,
  origemCadastroLabel,
} from "@/lib/labels";
import { TIMEZONE, componentesSP } from "@/lib/timezone";
import { renderizarAssuntoBoasVindas, renderizarTemplateBoasVindas } from "@/lib/emailBoasVindas";
import { renderizarTemplateMensagem, saudacaoAtual } from "@/lib/templatesMensagem";
import { estiloFundoTela } from "@/lib/fundo";
import { dataEhFutura } from "@/lib/validacaoSessao";
import AgendaCalendario from "./AgendaCalendario";
import DatePickerSP from "./DatePickerSP";
import AnexosPaciente from "./AnexosPaciente";
import AnamneseEditor from "./AnamneseEditor";
import { pode, type Papel } from "@/lib/permissoes";
import ContextoSwitcher from "../_components/ContextoSwitcher";

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

// Status disponíveis para o operador escolher manualmente para um paciente
const STATUS_PACIENTE_OPCOES = ["ATIVO", "FINALIZADO", "CANCELADO"] as const;

// Abas de filtro da lista de pacientes
const FILTROS_PACIENTE = [
  { valor: "ativos", rotulo: "Ativos" },
  { valor: "finalizados", rotulo: "Finalizados" },
  { valor: "cancelados", rotulo: "Cancelados" },
  { valor: "todos", rotulo: "Todos" },
] as const;
type FiltroPaciente = (typeof FILTROS_PACIENTE)[number]["valor"];

interface Paciente {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  cpf: string | null;
  rg: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  quemIndicou: string | null;
  dataNascimento: string | null;
  estadoCivil: string | null;
  nacionalidade: string | null;
  profissao: string | null;
  instagram: string | null;
  pastaDriveUrl: string | null;
  origemCadastro: string;
  diaPreferido: string;
  horarioFixo: string;
  tipoSessaoId: string | null;
  statusGeral: "ATIVO" | "CANCELADO" | "FINALIZADO";
  anamnese: string | null;
}

// Formato retornado por GET /api/pacientes (listagem) — só os campos
// renderizados no card e usados na busca; o cadastro completo (anamnese,
// CPF, endereço etc.) é buscado sob demanda via GET /api/pacientes/[id]
// ao abrir o painel lateral, o modal de edição ou a anamnese.
interface PacienteResumo {
  id: string;
  nome: string;
  telefone: string | null;
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
interface Tarefa {
  id: string;
  tipo: "RENOVACAO" | "CONTA";
  origem: "SISTEMA" | "MANUAL";
  titulo: string;
  descricao: string | null;
  pacienteId: string | null;
  dataVencimento: string | null;
  dataAviso: string | null;
  recorrencia: "NENHUMA" | "MENSAL";
  status: "PENDENTE" | "CONCLUIDA";
}
interface Notificacoes {
  reagendadas: NotificacaoSessao[];
  tarefas: Tarefa[];
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
  nome: string;
  nomeExibicao: string | null;
  logo: string | null;
  fundoUrl: string | null;
  fundoOpacidade: number;
  fundoAjuste: string;
  nomeAssistente: string;
  horarioLimiteConfirmacao: string;
  emailBoasVindasAssunto: string;
  emailBoasVindasCorpo: string;
  templateConfirmacao: string;
  templateMeet: string;
  sheetsPlanilhaId: string | null;
  mentoriaAtivada: boolean;
}

interface GoogleStatus {
  conectado: boolean;
  prontoParaCompartilhar: boolean;
}

interface TipoSessao {
  id: string;
  nome: string;
  ehAtendimentoUnico: boolean;
}

// Estado inicial do formulário de novo paciente
const FORM_VAZIO = {
  nome: "",
  cpf: "",
  rg: "",
  telefone: "",
  email: "",
  dataNascimento: "",
  estadoCivil: "",
  nacionalidade: "",
  profissao: "",
  instagram: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  estado: "",
  quemIndicou: "",
  pastaDriveUrl: "",
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

// Data ("YYYY-MM-DD") e horário ("HH:MM") de um ISO no calendário de São
// Paulo, para pré-preencher o form de edição a partir do valor atual da sessão
function dataHoraCamposSP(iso: string): { novaData: string; novoHorario: string } {
  const c = componentesSP(new Date(iso));
  return {
    novaData: `${c.ano}-${String(c.mes).padStart(2, "0")}-${String(c.dia).padStart(2, "0")}`,
    novoHorario: `${String(c.hora).padStart(2, "0")}:${String(c.minuto).padStart(2, "0")}`,
  };
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
    case "ATIVO":
      return "bg-green";
    case "NAO_REALIZADA":
    case "CANCELADO":
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

// Ícone de prancheta (botão Anamnese)
function IconPrancheta({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M7 3.5h6a1 1 0 0 1 1 1V4h.5A1.5 1.5 0 0 1 16 5.5v10a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 15.5v-10A1.5 1.5 0 0 1 5.5 4H6v.5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M7.5 9h5M7.5 12h5M7.5 6h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
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
  opcoes = STATUS_SESSAO_OPCOES,
  disabled,
  onEscolher,
}: {
  status: string;
  opcoes?: readonly string[];
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
          {opcoes.map((st) => (
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

  const [abaAtiva, setAbaAtiva] = useState<"pacientes" | "agenda">("agenda");

  const [pacientes, setPacientes] = useState<PacienteResumo[]>([]);
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtroPaciente, setFiltroPaciente] = useState<FiltroPaciente>("ativos");
  const [statusPacienteSalvandoId, setStatusPacienteSalvandoId] = useState<string | null>(null);
  const [saindo, setSaindo] = useState(false);
  const [clinica, setClinica] = useState<Clinica | null>(null);
  // Controla o aparecimento sincronizado do grupo de botões de navegação
  // (Agenda/Pacientes/Tarefas/Mentoria) — ver useEffect de carregarClinica/carregarPapel.
  const [acessoErro, setAcessoErro] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [tiposSessao, setTiposSessao] = useState<TipoSessao[]>([]);

  // Sino de notificações (sessões reagendadas + tarefas pendentes)
  const [notificacoes, setNotificacoes] = useState<Notificacoes>({ reagendadas: [], tarefas: [] });
  const [sinoAberto, setSinoAberto] = useState(false);
  const [avisoNotificacao, setAvisoNotificacao] = useState("");
  const [tarefaConcluindoId, setTarefaConcluindoId] = useState<string | null>(null);

  // Modal: criar tarefa manual (tipo CONTA)
  const [modalTarefa, setModalTarefa] = useState(false);
  const [tituloTarefa, setTituloTarefa] = useState("");
  const [descricaoTarefa, setDescricaoTarefa] = useState("");
  const [dataVencimentoTarefa, setDataVencimentoTarefa] = useState("");
  const [dataAvisoTarefa, setDataAvisoTarefa] = useState("");
  const [recorrenciaTarefa, setRecorrenciaTarefa] = useState<"NENHUMA" | "MENSAL">("NENHUMA");
  const [salvandoTarefa, setSalvandoTarefa] = useState(false);
  const [erroTarefa, setErroTarefa] = useState("");

  const [modalAberto, setModalAberto] = useState(false);
  const [pacienteEditando, setPacienteEditando] = useState<Paciente | null>(null);
  const [rolarAnamneseAoAbrir, setRolarAnamneseAoAbrir] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState("");

  // Paciente selecionado (abre o painel lateral de sessões) e suas sessões
  const [pacienteSelecionado, setPacienteSelecionado] = useState<Paciente | null>(null);
  // Só espelha o que a UI mostra/habilita — a checagem de verdade é sempre
  // no servidor (src/lib/permissoes.ts + cada rota).
  const [papel, setPapel] = useState<Papel | null>(null);
  const podeExcluirPaciente = papel !== null && pode(papel, "excluirPaciente");
  // Aparecimento sincronizado do grupo de botões de navegação: só "resolvido"
  // quando os dois fetches (clínica e papel) já chegaram.
  const acessoResolvido = clinica !== null && papel !== null;
  const acessoResolvidoRef = useRef(acessoResolvido);
  acessoResolvidoRef.current = acessoResolvido;
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
  const [tipoSessaoPacote, setTipoSessaoPacote] = useState("");
  const [salvandoPacote, setSalvandoPacote] = useState(false);
  const [erroPacote, setErroPacote] = useState("");

  // Modal: editar sessão pontual (nova data completa + novo horário)
  const [sessaoEditando, setSessaoEditando] = useState<Sessao | null>(null);
  const [formEditar, setFormEditar] = useState({ novaData: "", novoHorario: "" });
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
  const [modalTrazer, setModalTrazer] = useState(false);
  const [sessaoCorteId, setSessaoCorteId] = useState("");
  const [salvandoAdiar, setSalvandoAdiar] = useState(false);
  const [erroAdiar, setErroAdiar] = useState("");

  // Modal: reverter sessões futuras marcadas incorretamente
  const [modalReverterFuturas, setModalReverterFuturas] = useState(false);
  const [salvandoReverterFuturas, setSalvandoReverterFuturas] = useState(false);
  const [erroReverterFuturas, setErroReverterFuturas] = useState("");
  const [feedbackReverterFuturas, setFeedbackReverterFuturas] = useState("");

  // Modal: cancelar sessão com motivo obrigatório
  const [sessaoCancelando, setSessaoCancelando] = useState<Sessao | null>(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState("");
  const [arquivarCancelamento, setArquivarCancelamento] = useState(false);
  const [salvandoCancelar, setSalvandoCancelar] = useState(false);
  const [erroCancelar, setErroCancelar] = useState("");

  // Seleção múltipla de sessões + barra de ações em lote
  const [sessoesSelecionadas, setSessoesSelecionadas] = useState<Set<string>>(new Set());
  const [aplicandoLote, setAplicandoLote] = useState(false);
  const [erroLote, setErroLote] = useState("");
  const [feedbackLote, setFeedbackLote] = useState<string | null>(null);

  // Modal: cancelar em lote — mesmo motivo aplicado a todas as selecionadas
  const [modalCancelarLote, setModalCancelarLote] = useState(false);
  const [motivoCancelamentoLote, setMotivoCancelamentoLote] = useState("");
  const [arquivarCancelamentoLote, setArquivarCancelamentoLote] = useState(false);

  // Modal: excluir paciente — trava exige digitar o nome do paciente
  const [pacienteExcluindo, setPacienteExcluindo] = useState<Paciente | null>(null);
  const [confirmacaoExclusao, setConfirmacaoExclusao] = useState("");
  const [salvandoExclusao, setSalvandoExclusao] = useState(false);
  const [erroExclusao, setErroExclusao] = useState("");

  // Modal: compartilhar pasta do Drive + enviar e-mail de boas-vindas
  const [compartilhando, setCompartilhando] = useState(false);
  const [assuntoCompartilhar, setAssuntoCompartilhar] = useState("");
  const [corpoCompartilhar, setCorpoCompartilhar] = useState("");
  const [enviandoCompartilhar, setEnviandoCompartilhar] = useState(false);
  const [erroCompartilhar, setErroCompartilhar] = useState("");
  const [resultadoCompartilhar, setResultadoCompartilhar] = useState<{
    pastaCompartilhada: boolean;
    emailEnviado: boolean;
  } | null>(null);

  // Modal: pré-visualização e confirmação da importação de pacientes (Google
  // Sheets) — movido de Configurações > Integrações porque quem dispara a
  // importação no dia a dia é o OPERADOR, que não acessa aquela seção. A
  // *configuração* da planilha/aba continua restrita a ADMIN/PROFISSIONAL lá.
  const [carregandoPreviewImportacao, setCarregandoPreviewImportacao] = useState(false);
  const [erroPreviewImportacao, setErroPreviewImportacao] = useState("");
  const [previewImportacaoAberto, setPreviewImportacaoAberto] = useState(false);
  const [previewImportacao, setPreviewImportacao] = useState<{
    total: number;
    novos: number;
    existentes: number;
    registros: Array<{ nome?: string; cpf?: string; status: string }>;
  } | null>(null);
  const [cpfsSelecionadosImportacao, setCpfsSelecionadosImportacao] = useState<Set<string>>(new Set());
  const [confirmandoImportacao, setConfirmandoImportacao] = useState(false);
  const [erroExecutarImportacao, setErroExecutarImportacao] = useState("");
  const [resultadoImportacao, setResultadoImportacao] = useState<{
    criados: number;
    pulados: number;
    erros: number;
  } | null>(null);

  // Busca a lista de pacientes da clínica logada, filtrada pela aba ativa
  async function carregarPacientes() {
    setCarregandoLista(true);
    try {
      const res = await fetch(`/api/pacientes?filtro=${filtroPaciente}`);
      if (res.ok) {
        setPacientes(await res.json());
      }
    } finally {
      setCarregandoLista(false);
    }
  }

  // Recarrega a lista de pacientes (respeitando a aba ativa) e sincroniza o
  // paciente aberto no painel lateral (o statusGeral dele pode mudar sozinho:
  // pacote finalizado, renovação, etc.) — o painel guarda o cadastro
  // completo, então a atualização busca o detalhe de novo, não só o resumo
  // da listagem.
  async function recarregarPacienteSelecionado() {
    await carregarPacientes();
    if (!pacienteSelecionado) return;
    const res = await fetch(`/api/pacientes/${pacienteSelecionado.id}`);
    if (res.ok) setPacienteSelecionado(await res.json());
  }

  async function carregarClinica() {
    try {
      const res = await fetch("/api/clinica");
      if (res.ok) setClinica(await res.json());
      else setAcessoErro(true);
    } catch {
      setAcessoErro(true);
    }
  }

  async function carregarPapel() {
    try {
      const res = await fetch("/api/auth/usuario");
      if (res.ok) setPapel((await res.json()).papel);
      else setAcessoErro(true);
    } catch {
      setAcessoErro(true);
    }
  }

  async function carregarGoogleStatus() {
    const res = await fetch("/api/integracoes/google/status");
    if (res.ok) setGoogleStatus(await res.json());
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

  function soDigitos(s: string): string {
    return (s || "").replace(/\D/g, "");
  }

  async function handleAbrirPreviewImportacao() {
    setCarregandoPreviewImportacao(true);
    setErroPreviewImportacao("");
    setResultadoImportacao(null);

    try {
      const res = await fetch("/api/importacao/preview");
      const dados = await res.json().catch(() => null);

      if (!res.ok) {
        setErroPreviewImportacao(dados?.erro ?? "não foi possível pré-visualizar a importação");
        return;
      }

      setPreviewImportacao(dados);
      // Default: todos os "novos" vêm marcados — o toggle mestre permite
      // desmarcar tudo de uma vez para escolher só os poucos que interessam.
      const registrosNovos = (dados?.registros ?? []) as Array<{ cpf?: string; status: string }>;
      setCpfsSelecionadosImportacao(
        new Set(
          registrosNovos
            .filter((r) => r.status === "novo")
            .map((r) => soDigitos(r.cpf || ""))
            .filter(Boolean)
        )
      );
      setPreviewImportacaoAberto(true);
    } catch {
      setErroPreviewImportacao("não foi possível pré-visualizar a importação");
    } finally {
      setCarregandoPreviewImportacao(false);
    }
  }

  function alternarSelecaoTodosImportacao(novosRegistros: Array<{ cpf?: string }>) {
    const todasAsChaves = novosRegistros.map((r) => soDigitos(r.cpf || "")).filter(Boolean);
    setCpfsSelecionadosImportacao((atual) =>
      atual.size === todasAsChaves.length ? new Set() : new Set(todasAsChaves)
    );
  }

  function alternarSelecaoImportacao(cpf: string) {
    const chave = soDigitos(cpf || "");
    if (!chave) return;
    setCpfsSelecionadosImportacao((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave)) novo.delete(chave);
      else novo.add(chave);
      return novo;
    });
  }

  async function handleConfirmarImportacao() {
    setConfirmandoImportacao(true);
    setErroExecutarImportacao("");

    try {
      const res = await fetch("/api/importacao/executar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpfs: Array.from(cpfsSelecionadosImportacao) }),
      });
      const dados = await res.json().catch(() => null);

      if (!res.ok) {
        setErroExecutarImportacao(dados?.erro ?? "não foi possível concluir a importação");
        return;
      }

      setResultadoImportacao(dados);
      await carregarPacientes();
    } catch {
      setErroExecutarImportacao("não foi possível concluir a importação");
    } finally {
      setConfirmandoImportacao(false);
    }
  }

  function fecharPreviewImportacao() {
    setPreviewImportacaoAberto(false);
    setPreviewImportacao(null);
    setResultadoImportacao(null);
    setErroExecutarImportacao("");
    setCpfsSelecionadosImportacao(new Set());
  }

  useEffect(() => {
    carregarPapel();
    carregarClinica();
    carregarTiposSessao();
    carregarNotificacoes();
    carregarGoogleStatus();
  }, []);

  // Fail-safe: se clínica/papel não resolverem em ~4s (fetch pendurado), trata
  // como erro em vez de deixar o skeleton do grupo de botões para sempre.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!acessoResolvidoRef.current) setAcessoErro(true);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  // Recarrega a lista sempre que a aba de filtro (Ativos/Finalizados/Cancelados/Todos) muda
  useEffect(() => {
    carregarPacientes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroPaciente]);

  // Lista filtrada por nome, ignorando maiúsculas/minúsculas e acentos
  const pacientesFiltrados = useMemo(() => {
    const termo = normalizar(busca.trim());
    if (!termo) return pacientes;
    return pacientes.filter((p) => normalizar(p.nome).includes(termo));
  }, [pacientes, busca]);

  const totalPendencias = notificacoes.reagendadas.length + notificacoes.tarefas.length;

  // Sessões futuras marcadas incorretamente como Realizada/Não realizada —
  // mesmo critério da trava do servidor (validarStatusSessao/dataEhFutura).
  const sessoesFuturasParaReverter = useMemo(
    () =>
      sessoes.filter(
        (s) => (s.status === "REALIZADA" || s.status === "NAO_REALIZADA") && dataEhFutura(new Date(s.inicio))
      ),
    [sessoes]
  );

  function abrirModal() {
    setPacienteEditando(null);
    setForm({ ...FORM_VAZIO, tipoSessaoId: tiposSessao[0]?.id ?? "" });
    setErroForm("");
    setModalAberto(true);
  }

  // Abre o mesmo modal preenchido com os dados do paciente, para edição de
  // cadastro. Recebe só o id — a listagem não tem mais o cadastro completo
  // (CPF, endereço, anamnese etc.), então busca o detalhe sob demanda.
  async function abrirModalEdicao(pacienteId: string) {
    const res = await fetch(`/api/pacientes/${pacienteId}`);
    if (!res.ok) return;
    const p: Paciente = await res.json();
    setPacienteEditando(p);
    setForm({
      nome: p.nome,
      cpf: p.cpf ?? "",
      rg: p.rg ?? "",
      telefone: p.telefone ?? "",
      email: p.email ?? "",
      dataNascimento: p.dataNascimento ?? "",
      estadoCivil: p.estadoCivil ?? "",
      nacionalidade: p.nacionalidade ?? "",
      profissao: p.profissao ?? "",
      instagram: p.instagram ?? "",
      cep: p.cep ?? "",
      logradouro: p.logradouro ?? "",
      numero: p.numero ?? "",
      complemento: p.complemento ?? "",
      bairro: p.bairro ?? "",
      cidade: p.cidade ?? "",
      estado: p.estado ?? "",
      quemIndicou: p.quemIndicou ?? "",
      pastaDriveUrl: p.pastaDriveUrl ?? "",
      origemCadastro: p.origemCadastro,
      diaPreferido: p.diaPreferido,
      horarioFixo: p.horarioFixo,
      tipoSessaoId: p.tipoSessaoId ?? "",
    });
    setErroForm("");
    setRolarAnamneseAoAbrir(false);
    setModalAberto(true);
  }

  // Atalho usado na tela de atendimento: abre o mesmo modal de edição já
  // rolado até a seção Anamnese, pra ler as respostas sem precisar procurar.
  async function abrirAnamnese(pacienteId: string) {
    await abrirModalEdicao(pacienteId);
    setRolarAnamneseAoAbrir(true);
  }

  // Depois que o modal (e a seção Anamnese dentro dele) termina de montar,
  // rola até ela. Precisa esperar o próximo paint porque o conteúdo do
  // modal só existe no DOM depois que modalAberto vira true.
  useEffect(() => {
    if (!modalAberto || !rolarAnamneseAoAbrir) return;
    const id = requestAnimationFrame(() => {
      document.getElementById("secao-anamnese")?.scrollIntoView({ behavior: "smooth", block: "start" });
      setRolarAnamneseAoAbrir(false);
    });
    return () => cancelAnimationFrame(id);
  }, [modalAberto, rolarAnamneseAoAbrir]);

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
        const dados: Sessao[] = await res.json();
        setSessoes(dados);
        // Remove da seleção qualquer sessão que tenha virado consumida (ou
        // deixado de existir) nesse recarregamento, sem descartar o resto.
        setSessoesSelecionadas((atual) => {
          if (atual.size === 0) return atual;
          const elegiveis = new Set(
            dados.filter((s) => !STATUS_TRAVADOS.includes(s.status)).map((s) => s.id)
          );
          const novo = new Set(Array.from(atual).filter((id) => elegiveis.has(id)));
          return novo.size === atual.size ? atual : novo;
        });
      }
    } finally {
      setCarregandoSessoes(false);
    }
  }

  // Recebe só o id — a listagem não tem mais o cadastro completo, então o
  // painel lateral busca o detalhe sob demanda. Retorna false se o paciente
  // não existe mais (ex.: excluído), para quem chama poder avisar o usuário.
  async function abrirPainelPaciente(pacienteId: string): Promise<boolean> {
    const res = await fetch(`/api/pacientes/${pacienteId}`);
    if (!res.ok) return false;
    const p: Paciente = await res.json();
    setPacienteSelecionado(p);
    setSessoes([]);
    setSessoesSelecionadas(new Set());
    setErroLote("");
    setFeedbackLote(null);
    setFeedbackReverterFuturas("");
    carregarSessoes(p.id);
    return true;
  }

  function fecharPainelPaciente() {
    setPacienteSelecionado(null);
    setSessoes([]);
    setSessoesSelecionadas(new Set());
    setErroLote("");
    setFeedbackLote(null);
  }

  // Ao clicar numa pendência do sino, fecha o dropdown e abre o painel do
  // paciente. abrirPainelPaciente já busca o detalhe pelo id, então funciona
  // igual esteja o paciente na aba de filtro carregada atualmente ou não.
  async function abrirNotificacaoPaciente(pacienteId: string) {
    setSinoAberto(false);
    setAvisoNotificacao("");
    const ok = await abrirPainelPaciente(pacienteId);
    if (!ok) {
      setAvisoNotificacao("não foi possível abrir esse paciente — ele pode ter sido excluído.");
    }
  }

  // Conclui uma tarefa manual (tipo CONTA) e recarrega o sino
  async function concluirTarefa(tarefaId: string) {
    setTarefaConcluindoId(tarefaId);
    try {
      const res = await fetch(`/api/tarefas/${tarefaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CONCLUIDA" }),
      });
      if (res.ok) await carregarNotificacoes();
    } finally {
      setTarefaConcluindoId(null);
    }
  }

  function abrirModalTarefa() {
    setTituloTarefa("");
    setDescricaoTarefa("");
    setDataVencimentoTarefa("");
    setDataAvisoTarefa("");
    setRecorrenciaTarefa("NENHUMA");
    setErroTarefa("");
    setModalTarefa(true);
  }

  async function handleCriarTarefa(e: React.FormEvent) {
    e.preventDefault();
    if (!tituloTarefa.trim()) {
      setErroTarefa("informe o título");
      return;
    }
    setErroTarefa("");
    setSalvandoTarefa(true);
    try {
      const res = await fetch("/api/tarefas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "CONTA",
          titulo: tituloTarefa.trim(),
          descricao: descricaoTarefa.trim() || undefined,
          dataVencimento: dataVencimentoTarefa || undefined,
          dataAviso: dataAvisoTarefa || undefined,
          recorrencia: recorrenciaTarefa,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErroTarefa(data?.erro ?? "não foi possível criar a tarefa");
        return;
      }
      setModalTarefa(false);
      await carregarNotificacoes();
    } catch {
      setErroTarefa("não foi possível criar a tarefa");
    } finally {
      setSalvandoTarefa(false);
    }
  }

  // Criação de atendimento (só aparece quando o paciente ainda não tem sessões)
  function abrirModalPacote() {
    setTipoPacote(TIPOS_PACOTE[0]);
    setTotalPacote("");
    setDataInicialPacote("");
    setHorarioPacote("");
    // Pré-seleciona o tipo de atendimento cadastrado no paciente — o operador pode trocar
    setTipoSessaoPacote(pacienteSelecionado?.tipoSessaoId ?? tiposSessao[0]?.id ?? "");
    setErroPacote("");
    setModalPacote(true);
  }

  // Tipo de atendimento marcado como "atendimento único" (ex.: avaliação) só
  // permite recorrência Avulsa — ao trocar para um desses, colapsa na hora.
  function handleTrocarTipoSessaoPacote(novoId: string) {
    setTipoSessaoPacote(novoId);
    const tipo = tiposSessao.find((t) => t.id === novoId);
    if (tipo?.ehAtendimentoUnico) setTipoPacote(TIPOS_PACOTE[0]);
  }

  const tipoSessaoPacoteEhUnico = tiposSessao.find((t) => t.id === tipoSessaoPacote)?.ehAtendimentoUnico ?? false;

  async function handleCriarPacote(e: React.FormEvent) {
    e.preventDefault();
    if (!pacienteSelecionado) return;
    if (!dataInicialPacote || !horarioPacote) {
      setErroPacote("informe o dia e o horário da 1ª sessão");
      return;
    }
    if (!tipoSessaoPacote) {
      setErroPacote("informe o tipo de atendimento");
      return;
    }
    setErroPacote("");
    setSalvandoPacote(true);

    try {
      const body: Record<string, unknown> = {
        pacienteId: pacienteSelecionado.id,
        tipo: tipoPacote,
        dataInicial: dataInicialPacote,
        horario: horarioPacote,
        tipoSessaoId: tipoSessaoPacote,
      };
      if (tipoPacote === "PERSONALIZADO") {
        body.totalSessoes = Number(totalPacote);
      }

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

  // Troca manual do status (statusGeral) de um paciente via dropdown. Rótulo
  // reversível — não mexe em sessões.
  async function handleMudarStatusPaciente(pacienteId: string, novoStatus: string) {
    setStatusPacienteSalvandoId(pacienteId);
    try {
      const res = await fetch(`/api/pacientes/${pacienteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusGeral: novoStatus }),
      });
      if (res.ok) {
        await recarregarPacienteSelecionado();
        await carregarNotificacoes();
      }
    } finally {
      setStatusPacienteSalvandoId(null);
    }
  }

  // Edição pontual de data/horário de uma sessão — pré-preenche com o valor
  // atual, já que agora qualquer data pode ser escolhida (não só a semana
  // original)
  function abrirModalEditar(s: Sessao) {
    setSessaoEditando(s);
    setFormEditar(dataHoraCamposSP(s.inicio));
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
  function abrirModalTrazer() {
    const primeiraDisponivel = sessoes.find((s) => !STATUS_TRAVADOS.includes(s.status));
    setSessaoCorteId(primeiraDisponivel?.id ?? "");
    setErroAdiar("");
    setModalTrazer(true);
  }

  async function handleSalvarTrazer(e: React.FormEvent) {
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
        setErroAdiar(data?.erro ?? "não foi possível trazer as sessões");
        return;
      }

      setModalTrazer(false);
      await carregarSessoes(pacienteSelecionado.id);
      await carregarNotificacoes();
    } catch {
      setErroAdiar("não foi possível trazer as sessões");
    } finally {
      setSalvandoAdiar(false);
    }
  }

  // Reverte sessões futuras marcadas incorretamente como Realizada/Não realizada
  async function handleReverterFuturas() {
    if (!pacienteSelecionado) return;
    setErroReverterFuturas("");
    setSalvandoReverterFuturas(true);

    try {
      const res = await fetch(`/api/pacientes/${pacienteSelecionado.id}/reverter-futuras`, {
        method: "POST",
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setErroReverterFuturas(data?.erro ?? "não foi possível reverter as sessões");
        return;
      }

      setModalReverterFuturas(false);
      setFeedbackReverterFuturas(`${data.revertidas} ${data.revertidas === 1 ? "sessão revertida" : "sessões revertidas"} para Agendada`);
      await carregarSessoes(pacienteSelecionado.id);
      await carregarNotificacoes();
    } catch {
      setErroReverterFuturas("não foi possível reverter as sessões");
    } finally {
      setSalvandoReverterFuturas(false);
    }
  }

  // Cancelamento de sessão com motivo obrigatório
  function abrirModalCancelar(s: Sessao) {
    setSessaoCancelando(s);
    setMotivoCancelamento("");
    setArquivarCancelamento(false);
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
        body: JSON.stringify({ status: "CANCELADA", motivoCancelamento: motivo, arquivar: arquivarCancelamento }),
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

  // Seleção múltipla de sessões para ações em lote — sessões travadas
  // (já consumidas) nunca entram na lista de elegíveis.
  const sessoesSelecionaveis = sessoes.filter((s) => !STATUS_TRAVADOS.includes(s.status));
  const todasSelecionadas =
    sessoesSelecionaveis.length > 0 && sessoesSelecionaveis.every((s) => sessoesSelecionadas.has(s.id));

  function toggleSelecaoSessao(id: string) {
    setSessoesSelecionadas((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function toggleSelecionarTodas() {
    setSessoesSelecionadas(todasSelecionadas ? new Set() : new Set(sessoesSelecionaveis.map((s) => s.id)));
  }

  // Aplica uma ação em lote (status ou cancelamento) às sessões selecionadas.
  // Retorna true em caso de sucesso, para o chamador (ex.: modal de
  // cancelamento em lote) decidir se fecha o modal.
  async function handleAplicarLote(status: string, motivo?: string, arquivar?: boolean): Promise<boolean> {
    if (!pacienteSelecionado || sessoesSelecionadas.size === 0) return false;
    setAplicandoLote(true);
    setErroLote("");
    setFeedbackLote(null);

    try {
      const res = await fetch("/api/sessoes/lote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(sessoesSelecionadas),
          status,
          ...(motivo ? { motivoCancelamento: motivo, arquivar: Boolean(arquivar) } : {}),
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErroLote(data?.erro ?? "não foi possível aplicar a ação em lote");
        return false;
      }
      if (!data.aplicadas) {
        setErroLote("nenhuma das sessões selecionadas pôde receber essa ação");
        return false;
      }

      const sessaoOuSessoes = data.aplicadas === 1 ? "sessão" : "sessões";
      let mensagem =
        status === "CANCELADA"
          ? `${data.aplicadas} ${sessaoOuSessoes} ${data.aplicadas === 1 ? "cancelada" : "canceladas"}`
          : `${data.aplicadas} ${sessaoOuSessoes} ${data.aplicadas === 1 ? "marcada" : "marcadas"} como ${statusLabel(status)}`;
      if (data.puladas > 0) {
        mensagem += ` (${data.puladas} ${data.puladas === 1 ? "ignorada" : "ignoradas"})`;
      }
      setFeedbackLote(mensagem);

      await carregarSessoes(pacienteSelecionado.id);
      await recarregarPacienteSelecionado();
      await carregarNotificacoes();
      return true;
    } catch {
      setErroLote("não foi possível aplicar a ação em lote");
      return false;
    } finally {
      setAplicandoLote(false);
    }
  }

  function abrirModalCancelarLote() {
    setMotivoCancelamentoLote("");
    setArquivarCancelamentoLote(false);
    setErroLote("");
    setModalCancelarLote(true);
  }

  async function handleConfirmarCancelamentoLote(e: React.FormEvent) {
    e.preventDefault();
    const motivo = motivoCancelamentoLote.trim();
    if (!motivo) {
      setErroLote("informe o motivo do cancelamento");
      return;
    }
    const ok = await handleAplicarLote("CANCELADA", motivo, arquivarCancelamentoLote);
    if (ok) setModalCancelarLote(false);
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

  // Diz por que o botão "Compartilhar pasta e enviar boas-vindas" está
  // desabilitado (null quando está tudo certo) — vira o tooltip do botão.
  function motivoBloqueioCompartilhar(p: Paciente): string | null {
    const faltando: string[] = [];
    if (!p.email) faltando.push("paciente sem e-mail cadastrado");
    if (!p.pastaDriveUrl) faltando.push("pasta do Drive não cadastrada");
    if (!googleStatus?.prontoParaCompartilhar) {
      faltando.push("Google não conectado ou sem permissão de Drive/Gmail (reconecte em Configurações)");
    }
    return faltando.length > 0 ? faltando.join(" · ") : null;
  }

  // Abre a tela de confirmação já preenchida com o template da clínica
  function abrirCompartilharPasta() {
    if (!pacienteSelecionado || !clinica) return;
    const primeiroNome = pacienteSelecionado.nome.split(" ")[0];
    setAssuntoCompartilhar(renderizarAssuntoBoasVindas(clinica.emailBoasVindasAssunto, primeiroNome));
    setCorpoCompartilhar(
      renderizarTemplateBoasVindas(clinica.emailBoasVindasCorpo, primeiroNome, pacienteSelecionado.pastaDriveUrl ?? "")
    );
    setErroCompartilhar("");
    setResultadoCompartilhar(null);
    setCompartilhando(true);
  }

  function fecharModalCompartilhar() {
    if (enviandoCompartilhar) return;
    setCompartilhando(false);
  }

  async function handleConfirmarCompartilhar() {
    if (!pacienteSelecionado) return;
    setErroCompartilhar("");
    setEnviandoCompartilhar(true);

    try {
      const res = await fetch(`/api/pacientes/${pacienteSelecionado.id}/compartilhar-pasta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assunto: assuntoCompartilhar, corpo: corpoCompartilhar }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setErroCompartilhar(data?.erro ?? "não foi possível compartilhar a pasta");
        return;
      }

      setResultadoCompartilhar(data);
    } catch {
      setErroCompartilhar("não foi possível compartilhar a pasta");
    } finally {
      setEnviandoCompartilhar(false);
    }
  }

  // Monta a mensagem de confirmação de sessão, pronta para copiar e colar
  // (mesmo template configurável usado no popup da agenda)
  function montarMensagemConfirmacao(s: Sessao) {
    if (!pacienteSelecionado || !clinica) return "";
    return renderizarTemplateMensagem(clinica.templateConfirmacao, {
      saudacao: saudacaoAtual(),
      paciente: pacienteSelecionado.nome.split(" ")[0],
      data: formatarDataCurta(s.inicio),
      hora: formatarHorario(s.inicio),
      horarioLimite: clinica.horarioLimiteConfirmacao,
      assistente: clinica.nomeAssistente,
    });
  }

  // Monta a mensagem com o link do Meet, pronta para copiar e colar
  function montarMensagemMeet(s: Sessao) {
    if (!pacienteSelecionado || !clinica) return "";
    return renderizarTemplateMensagem(clinica.templateMeet, {
      saudacao: saudacaoAtual(),
      paciente: pacienteSelecionado.nome.split(" ")[0],
      linkMeet: s.linkMeet ?? "(link ainda não gerado)",
      assistente: clinica.nomeAssistente,
    });
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
    <div className="relative flex h-screen flex-col overflow-hidden bg-bg">
      {/* Fundo de tela da clínica (identidade visual white-label). z-index
          negativo garante que fique sempre atrás do conteúdo em fluxo
          normal (que não tem z-index próprio) — um z-index 0 aqui pintaria
          por cima desse conteúdo, mesmo vindo antes no DOM. A opacidade é
          aplicada só nesta camada, nunca no conteúdo. */}
      {clinica?.fundoUrl && (
        <div
          className="pointer-events-none fixed inset-0 -z-10"
          style={{
            backgroundImage: `url(${clinica.fundoUrl})`,
            opacity: clinica.fundoOpacidade / 100,
            ...estiloFundoTela(clinica.fundoAjuste),
          }}
        />
      )}

      {/* Cabeçalho */}
      <header className="z-30 h-16 shrink-0 border-b border-border bg-surface">
        <div className="mx-auto flex h-full max-w-[1360px] items-center justify-between px-6">
          <button
            onClick={() => router.push("/painel")}
            className="flex items-center gap-2"
            aria-label="Ir para o painel"
          >
            {clinica?.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={clinica.logo} alt={clinica.nome} className="h-9 w-auto max-w-[180px] object-contain" />
            )}
            <span className="font-serif text-lg font-semibold text-fg">
              {clinica?.nomeExibicao || clinica?.nome || "Agenda Consultórios"}
            </span>
          </button>
          <div className="flex items-center gap-3">
            <ContextoSwitcher
              mentoriaDisponivel={clinica?.mentoriaAtivada === true && (papel === "PROFISSIONAL" || papel === "ADMIN")}
            />
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
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold text-fg">Pendências</p>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => router.push("/tarefas")}
                        className="text-xs font-medium text-muted hover:text-fg hover:underline"
                      >
                        Ver todas
                      </button>
                      <button
                        onClick={abrirModalTarefa}
                        className="text-xs font-medium text-gold hover:underline"
                      >
                        + Nova tarefa
                      </button>
                    </div>
                  </div>
                  {avisoNotificacao && (
                    <p className="mb-2 rounded-lg bg-red/10 px-2 py-1.5 text-xs text-red">{avisoNotificacao}</p>
                  )}
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
                      {notificacoes.tarefas.length > 0 && (
                        <div>
                          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                            Tarefas
                          </p>
                          <ul className="space-y-1">
                            {notificacoes.tarefas.map((t) => (
                              <li key={t.id} className="flex items-center gap-1">
                                {t.tipo === "RENOVACAO" ? (
                                  <button
                                    onClick={() => abrirNotificacaoPaciente(t.pacienteId!)}
                                    className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-fg hover:bg-bg"
                                  >
                                    <span className="font-medium">{t.titulo}</span>
                                    {t.dataVencimento && <> — vence em {formatarDataCurta(t.dataVencimento)}</>}
                                  </button>
                                ) : (
                                  <>
                                    <div className="flex-1 rounded-lg px-2 py-1.5 text-sm text-fg">
                                      <span className="font-medium">{t.titulo}</span>
                                      {t.dataVencimento && <> — vence em {formatarDataCurta(t.dataVencimento)}</>}
                                    </div>
                                    <button
                                      onClick={() => concluirTarefa(t.id)}
                                      disabled={tarefaConcluindoId === t.id}
                                      className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      {tarefaConcluindoId === t.id ? "..." : "Concluir"}
                                    </button>
                                  </>
                                )}
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

      <main className="mx-auto flex w-full min-h-0 max-w-[1360px] flex-1 flex-col overflow-hidden px-6 pb-6 pt-8">
        {/* Abas: lista de pacientes ou calendário da agenda — fixo, não rola */}
        <div className="mb-6 flex shrink-0 gap-2">
          {!acessoResolvido && !acessoErro ? (
            <>
              <div className="h-9 w-20 animate-pulse rounded-lg border border-border bg-bg" />
              <div className="h-9 w-24 animate-pulse rounded-lg border border-border bg-bg" />
              <div className="h-9 w-20 animate-pulse rounded-lg border border-border bg-bg" />
              <div className="h-9 w-24 animate-pulse rounded-lg border border-border bg-bg" />
            </>
          ) : acessoResolvido ? (
            <>
              <button
                onClick={() => setAbaAtiva("agenda")}
                className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                  abaAtiva === "agenda" ? "border-gold bg-gold/10 text-gold" : "border-border text-fg hover:bg-bg"
                }`}
              >
                Agenda
              </button>
              <button
                onClick={() => setAbaAtiva("pacientes")}
                className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                  abaAtiva === "pacientes" ? "border-gold bg-gold/10 text-gold" : "border-border text-fg hover:bg-bg"
                }`}
              >
                Pacientes
              </button>
              <button
                onClick={() => router.push("/tarefas")}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg"
              >
                Tarefas
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setAbaAtiva("agenda")}
                className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                  abaAtiva === "agenda" ? "border-gold bg-gold/10 text-gold" : "border-border text-fg hover:bg-bg"
                }`}
              >
                Agenda
              </button>
              <button
                onClick={() => setAbaAtiva("pacientes")}
                className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                  abaAtiva === "pacientes" ? "border-gold bg-gold/10 text-gold" : "border-border text-fg hover:bg-bg"
                }`}
              >
                Pacientes
              </button>
              <button
                onClick={() => router.push("/tarefas")}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg"
              >
                Tarefas
              </button>
            </>
          )}
        </div>

        {abaAtiva === "agenda" ? (
          <AgendaCalendario
            onEditarPaciente={(pacienteId) => {
              abrirModalEdicao(pacienteId);
            }}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Barra de busca + ação de novo paciente — fixa, não rola */}
            <div className="mb-6 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar paciente por nome..."
                className="w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-2 text-fg outline-none placeholder:text-muted focus:border-gold focus:ring-2 focus:ring-gold/20"
              />
              <div className="flex shrink-0 items-center gap-3">
                {clinica?.sheetsPlanilhaId && (
                  <button
                    onClick={handleAbrirPreviewImportacao}
                    disabled={carregandoPreviewImportacao}
                    className="rounded-lg border border-gold px-4 py-2 text-sm font-medium text-gold transition-colors hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {carregandoPreviewImportacao ? "Carregando..." : "Importar pacientes"}
                  </button>
                )}
                <button
                  onClick={abrirModal}
                  className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110"
                >
                  + Novo paciente
                </button>
              </div>
            </div>
            {erroPreviewImportacao && (
              <p className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroPreviewImportacao}</p>
            )}

            {/* Abas de filtro por status do paciente — fixas, não rolam */}
            <div className="mb-4 flex shrink-0 gap-2">
              {FILTROS_PACIENTE.map((f) => (
                <button
                  key={f.valor}
                  onClick={() => setFiltroPaciente(f.valor)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                    filtroPaciente === f.valor
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-border text-fg hover:bg-bg"
                  }`}
                >
                  {f.rotulo}
                </button>
              ))}
            </div>

            {/* Lista de pacientes — só ela rola */}
            <div className="flex-1 overflow-y-auto pb-8">
              {carregandoLista ? (
                <p className="text-sm text-muted">Carregando pacientes...</p>
              ) : pacientesFiltrados.length === 0 ? (
                <p className="text-sm text-muted">
                  Nenhum paciente encontrado.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {pacientesFiltrados.map((p) => (
                    <div
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => abrirPainelPaciente(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") abrirPainelPaciente(p.id);
                      }}
                      className={`cursor-pointer rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition-shadow hover:shadow-md hover:border-gold/40 ${
                        p.statusGeral !== "ATIVO" ? "opacity-60" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-fg">{p.nome}</p>
                          <p className="mt-1 text-sm text-muted">
                            {p.telefone ?? "sem telefone"}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            abrirModalEdicao(p.id);
                          }}
                          className="shrink-0 rounded-lg border border-border p-2 text-muted hover:bg-bg hover:text-fg"
                          aria-label="Editar cadastro"
                          title="Editar cadastro"
                        >
                          <IconLapis className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                        <MenuStatus
                          status={p.statusGeral}
                          opcoes={STATUS_PACIENTE_OPCOES}
                          disabled={statusPacienteSalvandoId === p.id}
                          onEscolher={(novoStatus) => handleMudarStatusPaciente(p.id, novoStatus)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Modal de cadastro de paciente */}
      {modalAberto && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-surface shadow-lg">
            <div className="flex shrink-0 items-center justify-between border-b border-border p-6 pb-4">
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

            <form onSubmit={handleSalvar} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-6 overflow-y-auto p-6">
              {/* Dados pessoais */}
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gold">
                  Dados pessoais
                </h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Campo label="Nome" name="nome" value={form.nome} onChange={handleChange} required className="sm:col-span-2" />
                  <Campo label="CPF" name="cpf" value={form.cpf} onChange={handleChange} />
                  <Campo label="RG" name="rg" value={form.rg} onChange={handleChange} />
                  <Campo label="Telefone" name="telefone" value={form.telefone} onChange={handleChange} />
                  <Campo label="E-mail" name="email" value={form.email} onChange={handleChange} type="email" className="sm:col-span-2" />
                  <Campo label="Data de nascimento" name="dataNascimento" value={form.dataNascimento} onChange={handleChange} placeholder="DD/MM/AAAA" />
                  <Campo label="Estado civil" name="estadoCivil" value={form.estadoCivil} onChange={handleChange} />
                  <Campo label="Nacionalidade" name="nacionalidade" value={form.nacionalidade} onChange={handleChange} />
                  <Campo label="Profissão" name="profissao" value={form.profissao} onChange={handleChange} />
                  <Campo label="Instagram" name="instagram" value={form.instagram} onChange={handleChange} placeholder="@usuario" />
                  <Campo label="Quem indicou" name="quemIndicou" value={form.quemIndicou} onChange={handleChange} />
                  <Campo
                    label="Link da pasta de gravações (Google Drive)"
                    name="pastaDriveUrl"
                    value={form.pastaDriveUrl}
                    onChange={handleChange}
                    type="url"
                    placeholder="https://drive.google.com/..."
                    className="sm:col-span-2"
                  />
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
                      Tipo de atendimento
                    </label>
                    {tiposSessao.length === 0 ? (
                      <p className="text-sm text-muted">
                        Nenhum tipo de atendimento cadastrado. Configure em Configurações → Tipos de atendimento.
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

              {/* Anamnese e Anexos — só disponíveis em modo edição, dependem de um pacienteId já salvo */}
              {pacienteEditando && (
                <div id="secao-anamnese">
                  <AnamneseEditor
                    pacienteId={pacienteEditando.id}
                    anamneseInicial={pacienteEditando.anamnese}
                  />
                </div>
              )}
              {pacienteEditando && <AnexosPaciente pacienteId={pacienteEditando.id} />}

              {erroForm && (
                <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
                  {erroForm}
                </p>
              )}
            </div>

            <div className="flex shrink-0 justify-end gap-3 border-t border-border p-6 pt-4">
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
            className="flex h-full w-full max-w-md flex-col border-l border-border bg-surface shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
          <div className="flex-shrink-0 border-b border-border p-6 pb-4">
            <div className="flex items-center justify-between">
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
                  <MenuStatus
                    status={pacienteSelecionado.statusGeral}
                    opcoes={STATUS_PACIENTE_OPCOES}
                    disabled={statusPacienteSalvandoId === pacienteSelecionado.id}
                    onEscolher={(novoStatus) => handleMudarStatusPaciente(pacienteSelecionado.id, novoStatus)}
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => abrirModalEdicao(pacienteSelecionado.id)}
                  className="text-muted hover:text-fg"
                  aria-label="Editar cadastro"
                  title="Editar cadastro"
                >
                  <IconLapis className="h-4 w-4" />
                </button>
                {podeExcluirPaciente && (
                  <button
                    onClick={() => abrirModalExcluir(pacienteSelecionado)}
                    className="text-muted hover:text-red"
                    aria-label="Excluir paciente"
                    title="Excluir paciente"
                  >
                    <IconLixeira className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={fecharPainelPaciente}
                  className="text-muted hover:text-fg"
                  aria-label="Fechar"
                >
                  ✕
                </button>
              </div>
            </div>

            <button
              onClick={() => abrirAnamnese(pacienteSelecionado.id)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-gold px-4 py-2.5 text-sm font-medium text-gold hover:bg-gold/10"
            >
              <IconPrancheta className="h-4 w-4" />
              Anamnese
            </button>

            {sessoesSelecionadas.size > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-gold/40 bg-gold/5 p-3">
                <span className="text-sm font-medium text-fg">
                  {sessoesSelecionadas.size}{" "}
                  {sessoesSelecionadas.size === 1 ? "sessão selecionada" : "sessões selecionadas"}
                </span>
                <div className="ml-auto flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleAplicarLote("REALIZADA")}
                    disabled={aplicandoLote}
                    className="rounded-lg border border-green px-2 py-1 text-sm font-medium text-green hover:bg-green/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Marcar como Realizada
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAplicarLote("NAO_REALIZADA")}
                    disabled={aplicandoLote}
                    className="rounded-lg border border-red px-2 py-1 text-sm font-medium text-red hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Marcar como Não realizada
                  </button>
                  <button
                    type="button"
                    onClick={abrirModalCancelarLote}
                    disabled={aplicandoLote}
                    className="rounded-lg border border-red px-2 py-1 text-sm font-medium text-red hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancelar selecionadas
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-6 pt-4">

            {/* Link das sessões: pasta do Drive com as gravações do paciente */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
              <p className="text-sm font-medium text-fg">Link das sessões</p>
              {pacienteSelecionado.pastaDriveUrl ? (
                <div className="flex items-center gap-2">
                  <a
                    href={pacienteSelecionado.pastaDriveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-blue px-3 py-1 text-sm font-medium text-blue hover:bg-blue/10"
                  >
                    Abrir pasta
                  </a>
                  <button
                    onClick={() => copiar(pacienteSelecionado.pastaDriveUrl!, "drive")}
                    className="rounded-lg border border-green px-3 py-1 text-sm font-medium text-green hover:bg-green/10"
                  >
                    {copiadoId === "drive" ? "Copiado!" : "Copiar link"}
                  </button>
                </div>
              ) : (
                <p className="text-sm text-muted">Nenhuma pasta cadastrada</p>
              )}
            </div>

            {/* Compartilhar a pasta com o paciente + e-mail de boas-vindas */}
            <div className="mb-4">
              <button
                onClick={abrirCompartilharPasta}
                disabled={motivoBloqueioCompartilhar(pacienteSelecionado) !== null}
                title={motivoBloqueioCompartilhar(pacienteSelecionado) ?? undefined}
                className="w-full rounded-lg border border-gold px-3 py-1.5 text-sm font-medium text-gold hover:bg-gold/10 disabled:cursor-not-allowed disabled:border-border disabled:text-muted disabled:hover:bg-transparent"
              >
                Compartilhar pasta e enviar boas-vindas
              </button>
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
                    onClick={abrirModalTrazer}
                    className="rounded-lg border border-orange px-3 py-1.5 text-sm font-medium text-orange hover:bg-orange/10"
                  >
                    Trazer
                  </button>
                  <button
                    onClick={() => {
                      setErroReverterFuturas("");
                      setModalReverterFuturas(true);
                    }}
                    disabled={sessoesFuturasParaReverter.length === 0}
                    title={
                      sessoesFuturasParaReverter.length === 0
                        ? "nenhuma sessão a corrigir"
                        : "Reverter sessões futuras marcadas incorretamente"
                    }
                    className="rounded-lg border border-red px-3 py-1.5 text-sm font-medium text-red hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Reverter sessões futuras marcadas incorretamente
                  </button>
                </>
              )}
            </div>

            {feedbackReverterFuturas && (
              <p className="mb-4 rounded-lg bg-green/10 px-3 py-2 text-sm text-green">{feedbackReverterFuturas}</p>
            )}

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
              <>
                <div className="mb-2 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm text-muted">
                    <input
                      type="checkbox"
                      checked={todasSelecionadas}
                      onChange={toggleSelecionarTodas}
                      disabled={sessoesSelecionaveis.length === 0}
                      className="h-4 w-4 rounded border-border disabled:cursor-not-allowed disabled:opacity-40"
                    />
                    Selecionar todas
                  </label>
                </div>

                {erroLote && (
                  <p className="mb-3 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroLote}</p>
                )}
                {feedbackLote && (
                  <p className="mb-3 rounded-lg bg-green/10 px-3 py-2 text-sm text-green">{feedbackLote}</p>
                )}

                <ul className="space-y-3">
                {sessoes.map((s) => {
                  const travada = STATUS_TRAVADOS.includes(s.status);
                  return (
                  <li
                    key={s.id}
                    className={`rounded-lg border border-border p-3 ${travada ? "opacity-70" : ""}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={sessoesSelecionadas.has(s.id)}
                          onChange={() => toggleSelecaoSessao(s.id)}
                          disabled={travada}
                          title={travada ? "Sessão consumida — não pode ser selecionada" : undefined}
                          className="mt-1 h-4 w-4 rounded border-border disabled:cursor-not-allowed disabled:opacity-40"
                        />
                        <div>
                          <p className="text-sm font-medium text-fg">
                            Sessão {s.numeroSessao}/{s.totalPacote}
                          </p>
                          <p className="text-sm text-muted">
                            {formatarDataHora(s.inicio)}
                          </p>
                        </div>
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
                        title={travada ? "Sessão consumida — somente leitura" : "Editar data e horário"}
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
              </>
            )}
          </div>
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
                {tiposSessao.length === 0 ? (
                  <p className="text-sm text-muted">
                    Nenhum tipo de atendimento cadastrado. Configure em Configurações → Tipos de atendimento.
                  </p>
                ) : (
                  <select
                    value={tipoSessaoPacote}
                    onChange={(e) => handleTrocarTipoSessaoPacote(e.target.value)}
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

              <div>
                <label className="mb-1 block text-sm font-medium text-fg">
                  Recorrência
                </label>
                <select
                  value={tipoPacote}
                  onChange={(e) => setTipoPacote(e.target.value)}
                  disabled={tipoSessaoPacoteEhUnico}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {(tipoSessaoPacoteEhUnico ? [TIPOS_PACOTE[0]] : TIPOS_PACOTE).map((t) => (
                    <option key={t} value={t}>
                      {tipoPacoteLabel(t)}
                    </option>
                  ))}
                </select>
                {tipoSessaoPacoteEhUnico && (
                  <p className="mt-1 text-xs text-muted">
                    Este tipo de atendimento é de atendimento único — a recorrência permite apenas Avulsa.
                  </p>
                )}
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
                  <label className="mb-1 block whitespace-nowrap text-sm font-medium text-fg">
                    Dia da 1ª sessão
                  </label>
                  <DatePickerSP value={dataInicialPacote} onChange={setDataInicialPacote} />
                </div>
                <div>
                  <label className="mb-1 block whitespace-nowrap text-sm font-medium text-fg">
                    Horário
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="14:00"
                    pattern="^([01]\d|2[0-3]):[0-5]\d$"
                    value={horarioPacote}
                    onChange={(e) => setHorarioPacote(mascararHorario(e.target.value))}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  />
                </div>
              </div>

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
                  disabled={salvandoPacote || !dataInicialPacote || !horarioPacote || !tipoSessaoPacote}
                  className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvandoPacote ? "Criando..." : "Criar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: criar tarefa manual (tipo CONTA) */}
      {modalTarefa && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">Nova tarefa</h2>
            <form onSubmit={handleCriarTarefa} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Título</label>
                <input
                  type="text"
                  required
                  value={tituloTarefa}
                  onChange={(e) => setTituloTarefa(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Descrição (opcional)</label>
                <textarea
                  value={descricaoTarefa}
                  onChange={(e) => setDescricaoTarefa(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block whitespace-nowrap text-sm font-medium text-fg">
                    Data de vencimento
                  </label>
                  <DatePickerSP value={dataVencimentoTarefa} onChange={setDataVencimentoTarefa} />
                </div>
                <div>
                  <label className="mb-1 block whitespace-nowrap text-sm font-medium text-fg">
                    Data de aviso
                  </label>
                  <DatePickerSP value={dataAvisoTarefa} onChange={setDataAvisoTarefa} />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Recorrência</label>
                <select
                  value={recorrenciaTarefa}
                  onChange={(e) => setRecorrenciaTarefa(e.target.value as "NENHUMA" | "MENSAL")}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                >
                  <option value="NENHUMA">Nenhuma</option>
                  <option value="MENSAL">Mensal</option>
                </select>
              </div>

              {erroTarefa && (
                <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroTarefa}</p>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalTarefa(false)}
                  disabled={salvandoTarefa}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoTarefa || !tituloTarefa.trim()}
                  className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvandoTarefa ? "Criando..." : "Criar"}
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
                  Nova data
                </label>
                <DatePickerSP
                  value={formEditar.novaData}
                  onChange={(valor) => setFormEditar((f) => ({ ...f, novaData: valor }))}
                />
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
                  onChange={(e) => setFormEditar((f) => ({ ...f, novoHorario: mascararHorario(e.target.value) }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
              <p className="text-xs text-muted">
                A sessão pode ir para qualquer data e horário (08:00–19:30), desde que não caia na mesma semana de outra sessão deste paciente.
              </p>

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
                  disabled={salvandoEditar || !formEditar.novaData || !formEditar.novoHorario}
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

              <label className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={arquivarCancelamento}
                  onChange={(e) => setArquivarCancelamento(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                Arquivar sessão (some do cadastro e da agenda)
              </label>

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

      {/* Modal: cancelar em lote — um único motivo aplicado a todas as selecionadas */}
      {modalCancelarLote && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">
              Cancelar {sessoesSelecionadas.size}{" "}
              {sessoesSelecionadas.size === 1 ? "sessão" : "sessões"}
            </h2>
            <form onSubmit={handleConfirmarCancelamentoLote} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">
                  Motivo do cancelamento
                </label>
                <textarea
                  required
                  rows={3}
                  value={motivoCancelamentoLote}
                  onChange={(e) => setMotivoCancelamentoLote(e.target.value)}
                  placeholder="Descreva o motivo do cancelamento..."
                  className="w-full resize-none rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none placeholder:text-muted focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={arquivarCancelamentoLote}
                  onChange={(e) => setArquivarCancelamentoLote(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                Arquivar sessões (somem do cadastro e da agenda)
              </label>

              {erroLote && (
                <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
                  {erroLote}
                </p>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalCancelarLote(false)}
                  disabled={aplicandoLote}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={aplicandoLote || !motivoCancelamentoLote.trim()}
                  className="rounded-lg bg-red px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {aplicandoLote ? "Cancelando..." : "Confirmar cancelamento"}
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

      {/* Modal: compartilhar pasta do Drive + enviar e-mail de boas-vindas */}
      {compartilhando && pacienteSelecionado && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">
              Compartilhar pasta e enviar boas-vindas
            </h2>

            {resultadoCompartilhar ? (
              <div className="space-y-4">
                <p
                  className={`rounded-lg px-3 py-2 text-sm ${
                    resultadoCompartilhar.pastaCompartilhada && resultadoCompartilhar.emailEnviado
                      ? "bg-green/10 text-green"
                      : "bg-red/10 text-red"
                  }`}
                >
                  {resultadoCompartilhar.pastaCompartilhada
                    ? "Pasta compartilhada com sucesso. "
                    : "Não foi possível compartilhar a pasta. "}
                  {resultadoCompartilhar.emailEnviado
                    ? "E-mail enviado com sucesso."
                    : "Não foi possível enviar o e-mail."}
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setCompartilhando(false)}
                    className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border border-gold/40 bg-gold/5 px-3 py-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">Destinatário</p>
                  <p className="text-sm font-semibold text-fg">{pacienteSelecionado.email}</p>
                </div>
                <p className="text-xs text-muted">
                  A pasta do Drive será compartilhada com este e-mail (permissão de leitura) e o
                  e-mail de boas-vindas será enviado a partir da conta Google conectada da clínica.
                </p>

                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Assunto</label>
                  <input
                    type="text"
                    value={assuntoCompartilhar}
                    onChange={(e) => setAssuntoCompartilhar(e.target.value)}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Corpo do e-mail</label>
                  <textarea
                    rows={10}
                    value={corpoCompartilhar}
                    onChange={(e) => setCorpoCompartilhar(e.target.value)}
                    className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  />
                </div>

                {erroCompartilhar && (
                  <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroCompartilhar}</p>
                )}

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={fecharModalCompartilhar}
                    disabled={enviandoCompartilhar}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmarCompartilhar}
                    disabled={enviandoCompartilhar || !assuntoCompartilhar.trim() || !corpoCompartilhar.trim()}
                    className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {enviandoCompartilhar ? "Enviando..." : "Confirmar e enviar"}
                  </button>
                </div>
              </div>
            )}
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
      {modalTrazer && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">
              Trazer sessões
            </h2>
            <form onSubmit={handleSalvarTrazer} className="space-y-4">
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
                  onClick={() => setModalTrazer(false)}
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
                  {salvandoAdiar ? "Trazendo..." : "Trazer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: reverter sessões futuras marcadas incorretamente */}
      {modalReverterFuturas && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">
              Reverter sessões futuras marcadas incorretamente
            </h2>
            <p className="text-sm text-fg">
              {sessoesFuturasParaReverter.length}{" "}
              {sessoesFuturasParaReverter.length === 1
                ? "sessão futura está marcada"
                : "sessões futuras estão marcadas"}{" "}
              como Realizada/Não realizada. Confirmar a reversão{" "}
              {sessoesFuturasParaReverter.length === 1 ? "dela" : "de todas"} para Agendada?
            </p>

            {erroReverterFuturas && (
              <p className="mt-3 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroReverterFuturas}</p>
            )}

            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setModalReverterFuturas(false)}
                disabled={salvandoReverterFuturas}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleReverterFuturas}
                disabled={salvandoReverterFuturas}
                className="rounded-lg bg-red px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {salvandoReverterFuturas ? "Revertendo..." : "Reverter"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: pré-visualização e confirmação da importação de pacientes */}
      {previewImportacaoAberto && previewImportacao && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">
              Importar pacientes da planilha
            </h2>

            {resultadoImportacao ? (
              <>
                <p className="mb-4 rounded-lg bg-green/10 px-3 py-2 text-sm text-green">
                  {resultadoImportacao.criados} paciente(s) criado(s), {resultadoImportacao.pulados} pulado(s)
                  {resultadoImportacao.erros > 0 ? `, ${resultadoImportacao.erros} com erro` : ""}.
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={fecharPreviewImportacao}
                    className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110"
                  >
                    Fechar
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mb-3 text-sm text-fg">
                  <strong>{previewImportacao.novos}</strong> novo(s), <strong>{previewImportacao.existentes}</strong> já
                  existem na clínica.
                </p>

                {previewImportacao.novos > 0 ? (
                  <>
                    <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={
                            cpfsSelecionadosImportacao.size > 0 &&
                            cpfsSelecionadosImportacao.size ===
                              previewImportacao.registros
                                .filter((r) => r.status === "novo")
                                .map((r) => soDigitos(r.cpf || ""))
                                .filter(Boolean).length
                          }
                          onChange={() =>
                            alternarSelecaoTodosImportacao(
                              previewImportacao.registros.filter((r) => r.status === "novo")
                            )
                          }
                          className="h-4 w-4 rounded border-border"
                        />
                        Selecionar todos
                      </label>
                      <span>
                        {cpfsSelecionadosImportacao.size} de {previewImportacao.novos} selecionados
                      </span>
                    </div>
                    <div className="mb-4 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border bg-bg p-2">
                      {previewImportacao.registros
                        .filter((r) => r.status === "novo")
                        .map((r, i) => {
                          const chave = soDigitos(r.cpf || "");
                          return (
                            <label
                              key={i}
                              className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-surface"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={chave ? cpfsSelecionadosImportacao.has(chave) : false}
                                  disabled={!chave}
                                  onChange={() => alternarSelecaoImportacao(r.cpf || "")}
                                  className="h-4 w-4 shrink-0 rounded border-border disabled:cursor-not-allowed"
                                />
                                <span className="truncate text-fg">{r.nome || "(sem nome)"}</span>
                              </span>
                              <span className="shrink-0 font-mono text-xs text-muted">{r.cpf || "sem CPF"}</span>
                            </label>
                          );
                        })}
                    </div>
                  </>
                ) : (
                  <p className="mb-4 text-sm text-muted">Nenhum paciente novo para importar.</p>
                )}

                {erroExecutarImportacao && (
                  <p className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroExecutarImportacao}</p>
                )}

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={fecharPreviewImportacao}
                    disabled={confirmandoImportacao}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmarImportacao}
                    disabled={confirmandoImportacao || cpfsSelecionadosImportacao.size === 0}
                    className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {confirmandoImportacao ? "Importando..." : "Confirmar importação"}
                  </button>
                </div>
              </>
            )}
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
