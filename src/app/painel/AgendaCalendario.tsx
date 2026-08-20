"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { diaSemanaLabel, statusLabel } from "@/lib/labels";
import { TIMEZONE, componentesSP, criarDataSP } from "@/lib/timezone";
import { calcularLayoutColunas, type LayoutColuna } from "./overlapLayout";
import { textoLinhaBlocoAgenda } from "@/lib/blocoAgenda";
import { prepararTemplateMeet, renderizarTemplateMensagem, saudacaoAtual } from "@/lib/templatesMensagem";
import DatePickerSP from "./DatePickerSP";
import AnamneseModal from "./AnamneseModal";
import EmpurrarModal from "@/components/EmpurrarModal";

// Granularidade da grade: cada linha representa 30 minutos. A altura em
// pixels de cada linha (rowPx) é calculada em runtime a partir do espaço
// vertical disponível na tela, para a agenda do dia inteiro caber sem
// rolagem — ROW_PX_PADRAO é só o valor usado antes da primeira medição.
const ROW_MIN = 30;
const ROW_PX_PADRAO = 36;
const ROW_PX_MIN = 36;
const ROW_PX_MAX = 52;
const ALTURA_CABECALHO_DIA = 40; // h-10
// Piso de conteúdo: menor altura que ainda mostra as duas linhas do bloco
// (nome/nº + horário, text-[11px] leading-none, sem padding vertical) sem
// cortar. Estimativa analítica (2 linhas ≈ 22px + folga p/ acento/descendente
// de fonte) — não medida em navegador; ajuste aqui se a tela mostrar corte.
const FRESTA_MIN = 32;
// Vão fixo abaixo de cada card, igual em qualquer duração.
const GAP = 3;

const DIA_MS = 24 * 60 * 60 * 1000;
const STATUS_TRAVADOS = ["REALIZADA", "NAO_REALIZADA", "CANCELADA"];
const STATUS_SESSAO_OPCOES = ["AGENDADA", "REAGENDADA", "REALIZADA", "NAO_REALIZADA"] as const;
const DURACAO_OPCOES_MIN = [30, 45, 60, 90, 120];
const DURACAO_SNAP_MIN = 15;
const DIA_SEMANA_POR_INDICE = ["DOMINGO", "SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA", "SABADO"];

interface SessaoAgenda {
  id: string;
  pacoteId: string | null;
  pacienteId: string | null;
  paciente: { id: string; nome: string } | null;
  alunoId: string | null;
  aluno: { id: string; nomeCompleto: string } | null;
  numeroSessao: number | null;
  totalPacote: number | null;
  inicio: string;
  duracaoMin: number;
  status: string;
  arquivada: boolean;
  tipoSessaoId: string | null;
  tipoSessao: { id: string; nome: string; cor: string | null; ehAtendimentoUnico: boolean } | null;
  linkMeet: string | null;
  motivoCancelamento: string | null;
  confirmada: boolean;
}

// Nome de exibição de uma sessão — de paciente ou de mentorado (reunião
// avulsa). Espelha src/lib/blocoAgenda.ts:nomeSessao no backend.
function nomeDaSessao(sessao: SessaoAgenda): string {
  return sessao.paciente?.nome ?? sessao.aluno?.nomeCompleto ?? "";
}

type EscopoMove = "ESTA" | "ESTA_E_FUTURAS";

interface HorarioTrabalho {
  id: string;
  diaSemana: string;
  horaInicio: string;
  horaFim: string;
}

interface TipoSessaoOpcao {
  id: string;
  nome: string;
  cor: string | null;
  ehOnline: boolean;
  ehAtendimentoUnico: boolean;
}

interface ClinicaAgenda {
  nomeAssistente: string;
  horarioLimiteConfirmacao: string;
  templateConfirmacao: string;
  templateMeet: string;
  permitirResizeSessao: boolean;
  mentoriaAtivada: boolean;
}

interface PacienteOpcao {
  id: string;
  nome: string;
  telefone: string | null;
}

interface AlunoOpcao {
  id: string;
  nomeCompleto: string;
}

function horaParaMinutos(hora: string) {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

// Mesma regra do servidor: um dia sem faixa cadastrada está fechado quando a
// clínica já configurou algum horário; só cai na grade padrão 08:00–19:30
// quando a clínica ainda não configurou horário nenhum. Usada tanto ao
// arrastar (mudar dia/horário) quanto ao redimensionar (mudar duração).
function estaDentroExpediente(
  horarios: HorarioTrabalho[],
  diaSemanaNome: string,
  inicioMin: number,
  fimMin: number
): boolean {
  const horariosDia = horarios.filter((h) => h.diaSemana === diaSemanaNome);
  return horarios.length > 0
    ? horariosDia.some((hr) => inicioMin >= horaParaMinutos(hr.horaInicio) && fimMin <= horaParaMinutos(hr.horaFim))
    : inicioMin >= 8 * 60 && fimMin <= 19 * 60 + 30;
}

function minutosParaHora(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// 401 logo após o mount costuma ser o refresh de token do Supabase perdendo
// a corrida entre as chamadas paralelas do mount (proxy.ts não faz esse
// refresh de forma centralizada hoje — ver ARCHITECTURE.md §15.2); uma
// segunda tentativa ~500ms depois normalmente já pega o token renovado por
// alguma das outras chamadas. Só reage a 401 (não a 500/rede) — outros erros
// não têm motivo pra se resolver sozinhos numa segunda tentativa imediata.
async function fetchComRetry401(url: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(url, { signal });
  if (res.status !== 401) return res;
  await new Promise((resolve) => setTimeout(resolve, 500));
  return fetch(url, { signal });
}

// Todas as funções abaixo trabalham em componentes de calendário de São
// Paulo (via componentesSP/criarDataSP), nunca nos métodos locais do Date
// (getDay/getDate/setHours...) — esses dependem do fuso do navegador, que
// pode divergir do fuso da clínica.
function normalizarData(d: Date) {
  const c = componentesSP(d);
  return criarDataSP(c.ano, c.mes, c.dia, 0, 0, 0);
}

function segundaDaSemana(d: Date) {
  const c = componentesSP(d);
  const dist = c.diaSemana === 0 ? 6 : c.diaSemana - 1;
  const diaCalendario = new Date(Date.UTC(c.ano, c.mes - 1, c.dia) - dist * DIA_MS);
  return criarDataSP(diaCalendario.getUTCFullYear(), diaCalendario.getUTCMonth() + 1, diaCalendario.getUTCDate(), 0, 0, 0);
}

function mesmoDia(a: Date, b: Date) {
  const ca = componentesSP(a);
  const cb = componentesSP(b);
  return ca.ano === cb.ano && ca.mes === cb.mes && ca.dia === cb.dia;
}

function diaSemanaDeData(d: Date) {
  return DIA_SEMANA_POR_INDICE[componentesSP(d).diaSemana];
}

function formatarDiaMes(d: Date) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: TIMEZONE });
}

function formatarHorario(d: Date) {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE });
}

// "YYYY-MM-DD" de `d` no calendário de São Paulo, formato aceito pelo DatePickerSP
function dataISODeData(d: Date) {
  const c = componentesSP(d);
  return `${c.ano}-${String(c.mes).padStart(2, "0")}-${String(c.dia).padStart(2, "0")}`;
}

// Soma `dias` dias de calendário a `d`, preservando o horário de parede em
// São Paulo (aritmética em ms é segura aqui: o Brasil não observa horário de
// verão desde 2019, então o deslocamento UTC-3 é sempre fixo).
function somarDiasSP(d: Date, dias: number) {
  return new Date(d.getTime() + dias * DIA_MS);
}

// Copia texto pro clipboard; retorna se deu certo (contexto não seguro falha silenciosamente)
async function copiarParaClipboard(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

// Mesmo template configurável por clínica usado no painel do paciente
function montarMensagemConfirmacao(sessao: SessaoAgenda, clinica: ClinicaAgenda) {
  const inicio = new Date(sessao.inicio);
  return renderizarTemplateMensagem(clinica.templateConfirmacao, {
    saudacao: saudacaoAtual(),
    paciente: nomeDaSessao(sessao).split(" ")[0],
    data: formatarDiaMes(inicio),
    hora: formatarHorario(inicio),
    horarioLimite: clinica.horarioLimiteConfirmacao,
    assistente: clinica.nomeAssistente,
  });
}

// Texto do link do Meet — só é chamado quando sessao.linkMeet já existe (os
// botões de copiar ficam desabilitados sem link). Única view que mistura
// sessão de paciente (sempre com pacote) e reunião avulsa de mentorado (sem
// pacote, numeroSessao/totalPacote null) — por isso é a única que precisa de
// prepararTemplateMeet cobrir os dois casos (sem pacote e atendimento único)
// antes de renderizar.
function montarMensagemMeetCalendario(sessao: SessaoAgenda, clinica: ClinicaAgenda) {
  const temPacote = sessao.numeroSessao != null && sessao.totalPacote != null;
  const template = prepararTemplateMeet(clinica.templateMeet, {
    temPacote,
    ehAtendimentoUnico: sessao.tipoSessao?.ehAtendimentoUnico ?? false,
  });
  return renderizarTemplateMensagem(template, {
    nome: nomeDaSessao(sessao).split(" ")[0],
    data: formatarDiaMes(new Date(sessao.inicio)),
    hora: formatarHorario(new Date(sessao.inicio)),
    link: sessao.linkMeet ?? "",
    ...(temPacote ? { numero: String(sessao.numeroSessao), total: String(sessao.totalPacote) } : {}),
  });
}

// Cor sólida usada no ponto do menu de status (mesma paleta do painel principal)
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

export default function AgendaCalendario({
  onEditarPaciente,
}: {
  onEditarPaciente: (pacienteId: string) => void;
}) {
  const [modo, setModo] = useState<"semana" | "dia">("semana");
  const [refData, setRefData] = useState(() => normalizarData(new Date()));
  const [sessoes, setSessoes] = useState<SessaoAgenda[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroSessoes, setErroSessoes] = useState(false);
  const [horarios, setHorarios] = useState<HorarioTrabalho[]>([]);
  const [clinica, setClinica] = useState<ClinicaAgenda | null>(null);
  const [tiposSessao, setTiposSessao] = useState<TipoSessaoOpcao[]>([]);
  const [aviso, setAviso] = useState("");
  const [sessaoDetalhe, setSessaoDetalhe] = useState<SessaoAgenda | null>(null);
  const [anamnesePacienteId, setAnamnesePacienteId] = useState<string | null>(null);
  // Paciente-alvo do botão "Empurrar" do card — EmpurrarModal (componente
  // compartilhado com painel/page.tsx) é quem controla o formulário; aqui só
  // guarda pra quem a próxima chamada de /empurrar é.
  const [empurrarPacienteId, setEmpurrarPacienteId] = useState<string | null>(null);
  const [modalNovo, setModalNovo] = useState(false);
  // Alvo de um drag que tem irmã futura elegível — aguarda a escolha do
  // usuário no EscopoMoveModal antes de mover qualquer coisa (nem local, nem
  // no servidor).
  const [escopoPendente, setEscopoPendente] = useState<{
    sessao: SessaoAgenda;
    novaData: Date;
    novoHorario: string;
    qtdIrmas: number;
  } | null>(null);

  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const avisoTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Trava o grid (visual + interação) do início de um drag até a mutação
  // resolver — cobre a checagem de irmãs futuras, o modal de escopo (se
  // abrir) e o PATCH em si. Rede de segurança: se nenhum caminho destravar
  // em 25s (bug não previsto), força destravar sozinho.
  const [movendoSessao, setMovendoSessao] = useState(false);
  const lockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Aborta a busca anterior antes de disparar uma nova — sem isso, trocar de
  // semana rapidamente pode fazer uma resposta antiga (mais lenta) chegar
  // depois da mais recente e sobrescrever a semana atual com dados errados.
  const carregarSessoesController = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [rowPx, setRowPx] = useState(ROW_PX_PADRAO);
  // Relógio para esmaecer sessões cujo início já passou (recalcula sem precisar recarregar a página)
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Dias da semana em que a clínica atende, conforme o HorarioTrabalho —
  // null enquanto nenhuma faixa está configurada (aí mostra a semana toda).
  const diasTrabalhoSet = useMemo(() => {
    if (horarios.length === 0) return null;
    return new Set(horarios.map((h) => h.diaSemana));
  }, [horarios]);

  const dias = useMemo(() => {
    if (modo === "dia") return [refData];
    const seg = segundaDaSemana(refData);
    const semanaCompleta = Array.from({ length: 7 }, (_, i) => somarDiasSP(seg, i));
    if (!diasTrabalhoSet) return semanaCompleta;
    const diasComAtendimento = semanaCompleta.filter((d) => diasTrabalhoSet.has(diaSemanaDeData(d)));
    return diasComAtendimento.length > 0 ? diasComAtendimento : semanaCompleta;
  }, [refData, modo, diasTrabalhoSet]);

  const intervalo = useMemo(() => {
    const c0 = componentesSP(dias[0]);
    const inicio = criarDataSP(c0.ano, c0.mes, c0.dia, 0, 0, 0);
    const cUlt = componentesSP(dias[dias.length - 1]);
    const fim = criarDataSP(cUlt.ano, cUlt.mes, cUlt.dia, 23, 59, 59);
    return { inicio, fim };
  }, [dias]);

  const carregarSessoes = useCallback(async () => {
    carregarSessoesController.current?.abort();
    const controller = new AbortController();
    carregarSessoesController.current = controller;

    setCarregando(true);
    try {
      const params = new URLSearchParams({
        inicio: intervalo.inicio.toISOString(),
        fim: intervalo.fim.toISOString(),
      });
      const res = await fetchComRetry401(`/api/agenda?${params}`, controller.signal);
      // Só aplica se esta ainda for a requisição mais recente — uma resposta
      // de uma busca já abortada não deve sobrescrever a semana atual.
      if (carregarSessoesController.current !== controller) return;
      if (res.ok) {
        setSessoes(await res.json());
        setErroSessoes(false);
      } else {
        // Erro real (401 mesmo após retry, 500, etc.) — nunca deixar a grade
        // parecer "semana vazia" quando na verdade a busca falhou.
        setErroSessoes(true);
      }
    } catch (err) {
      // AbortError (DOMException, não instância de Error) é o caso esperado
      // de uma busca superada por uma mais nova — ignora silenciosamente.
      if ((err as { name?: string })?.name === "AbortError") return;
      if (carregarSessoesController.current === controller) setErroSessoes(true);
    } finally {
      if (carregarSessoesController.current === controller) setCarregando(false);
    }
  }, [intervalo]);

  useEffect(() => {
    // Mesmo padrão de falha silenciosa do carregarSessoes original — 401
    // (perdeu a corrida de refresh de token) tenta de novo uma vez; falha
    // definitiva vira aviso em vez de sumir sem explicação (aqui via
    // mostrarAviso, não um bloco de erro dedicado como a grade principal,
    // porque um horário/tipo de sessão ausente degrada a tela em vez de
    // esvaziá-la — a agenda continua utilizável com os defaults).
    fetchComRetry401("/api/clinica/horarios")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setHorarios)
      .catch(() => mostrarAviso("Não foi possível carregar o expediente da clínica."));
    fetchComRetry401("/api/clinica")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((c) =>
        setClinica({
          nomeAssistente: c.nomeAssistente,
          horarioLimiteConfirmacao: c.horarioLimiteConfirmacao,
          templateConfirmacao: c.templateConfirmacao,
          templateMeet: c.templateMeet,
          permitirResizeSessao: c.permitirResizeSessao,
          mentoriaAtivada: c.mentoriaAtivada ?? false,
        })
      )
      .catch(() => mostrarAviso("Não foi possível carregar os dados da clínica."));
    fetchComRetry401("/api/clinica/tipos-sessao")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setTiposSessao)
      .catch(() => mostrarAviso("Não foi possível carregar os tipos de sessão."));
  }, []);

  useEffect(() => {
    carregarSessoes();
  }, [carregarSessoes]);

  const janela = useMemo(() => {
    if (horarios.length === 0) return { inicioMin: 8 * 60, fimMin: 19 * 60 + 30 };
    const inicios = horarios.map((h) => horaParaMinutos(h.horaInicio));
    const fins = horarios.map((h) => horaParaMinutos(h.horaFim));
    return { inicioMin: Math.min(...inicios), fimMin: Math.max(...fins) };
  }, [horarios]);

  // Recalcula a altura de cada linha (rowPx) a partir do espaço vertical
  // realmente disponível abaixo do topo da grade, para o dia inteiro (do
  // horário de abertura ao de fechamento configurados) caber na tela sem
  // exigir rolagem — independente da resolução da tela do usuário.
  const recalcularRowPx = useCallback(() => {
    const el = boxRef.current;
    const totalMin = janela.fimMin - janela.inicioMin;
    if (!el || totalMin <= 0) return;
    const margemInferior = 40;
    const disponivel = window.innerHeight - el.getBoundingClientRect().top - ALTURA_CABECALHO_DIA - margemInferior;
    const px = (disponivel / totalMin) * ROW_MIN;
    setRowPx(Math.min(ROW_PX_MAX, Math.max(ROW_PX_MIN, Math.floor(px))));
  }, [janela]);

  useEffect(() => {
    recalcularRowPx();
    window.addEventListener("resize", recalcularRowPx);
    return () => window.removeEventListener("resize", recalcularRowPx);
  }, [recalcularRowPx, carregando]);

  const gridHeightPx = ((janela.fimMin - janela.inicioMin) / ROW_MIN) * rowPx;

  const marcadores = useMemo(() => {
    const lista: number[] = [];
    const primeiraHoraCheia = Math.ceil(janela.inicioMin / 60) * 60;
    for (let m = primeiraHoraCheia; m <= janela.fimMin; m += 60) lista.push(m);
    return lista;
  }, [janela]);

  const sessoesPorDia = useMemo(
    () => dias.map((dia) => sessoes.filter((s) => mesmoDia(new Date(s.inicio), dia))),
    [dias, sessoes]
  );

  // A linha de horário atual só existe quando o dia de hoje está entre os
  // dias exibidos (ex.: visão seg-sex não mostra a linha no fim de semana).
  const semanaTemHoje = useMemo(() => dias.some((dia) => mesmoDia(dia, new Date())), [dias]);

  function mostrarAviso(msg: string) {
    setAviso(msg);
    if (avisoTimeout.current) clearTimeout(avisoTimeout.current);
    avisoTimeout.current = setTimeout(() => setAviso(""), 4000);
  }

  const LOCK_TIMEOUT_MS = 25000;

  function travarMovimento() {
    setMovendoSessao(true);
    if (lockTimeoutRef.current) clearTimeout(lockTimeoutRef.current);
    lockTimeoutRef.current = setTimeout(() => {
      console.warn(
        "Lock de movimento da agenda destravado por timeout de segurança (25s) — algum caminho não liberou o lock."
      );
      setMovendoSessao(false);
    }, LOCK_TIMEOUT_MS);
  }

  function destravarMovimento() {
    if (lockTimeoutRef.current) {
      clearTimeout(lockTimeoutRef.current);
      lockTimeoutRef.current = null;
    }
    setMovendoSessao(false);
  }

  // No modo "dia", pula direto para o próximo dia em que a clínica atende
  // (sem parar num fim de semana ou dia fechado, por exemplo).
  function proximoDiaComAtendimento(d: Date, direcao: 1 | -1) {
    if (!diasTrabalhoSet) return somarDiasSP(d, direcao);
    let n = d;
    for (let i = 0; i < 7; i++) {
      n = somarDiasSP(n, direcao);
      if (diasTrabalhoSet.has(diaSemanaDeData(n))) return n;
    }
    return somarDiasSP(d, direcao);
  }

  function irAnterior() {
    setRefData((d) => (modo === "semana" ? somarDiasSP(d, -7) : proximoDiaComAtendimento(d, -1)));
  }
  function irProximo() {
    setRefData((d) => (modo === "semana" ? somarDiasSP(d, 7) : proximoDiaComAtendimento(d, 1)));
  }
  function irHoje() {
    setRefData(normalizarData(new Date()));
  }

  // Move a sessão localmente (otimista) e confirma no servidor; em caso de
  // falha (regra de negócio violada ou erro de rede), desfaz e avisa.
  // Escopo ESTA_E_FUTURAS move um lote no servidor (sessão arrastada +
  // irmãs futuras do pacote) — não faz otimismo local antes do fetch
  // (duplicaria a cadência semanal calculada no backend); ao confirmar
  // sucesso, aplica o resumo devolvido (id + novo início de cada sessão
  // movida) no estado local, e não só na sessão arrastada.
  async function moverSessao(
    sessao: SessaoAgenda,
    novaData: Date,
    novoHorario: string,
    escopo: EscopoMove = "ESTA"
  ) {
    const anteriores = sessoes;
    if (escopo === "ESTA") {
      setSessoes((prev) =>
        prev.map((s) => (s.id === sessao.id ? { ...s, inicio: novaData.toISOString(), status: "AGENDADA" } : s))
      );
    }
    try {
      const res = await fetch(`/api/sessoes/${sessao.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novaData: dataISODeData(novaData), novoHorario, escopo }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (escopo === "ESTA") setSessoes(anteriores);
        mostrarAviso(data?.erro ?? "não foi possível mover a sessão");
        return;
      }
      if (escopo === "ESTA_E_FUTURAS") {
        const data: { sessoes: { id: string; inicio: string }[] } = await res.json();
        const novoInicioPorId = new Map(data.sessoes.map((mov) => [mov.id, mov.inicio]));
        setSessoes((prev) =>
          prev.map((s) =>
            novoInicioPorId.has(s.id)
              ? { ...s, inicio: novoInicioPorId.get(s.id)!, ...(s.id === sessao.id ? { status: "AGENDADA" } : {}) }
              : s
          )
        );
      }
      await carregarSessoes();
    } catch {
      if (escopo === "ESTA") setSessoes(anteriores);
      mostrarAviso("não foi possível mover a sessão");
    }
  }

  // Redimensiona a sessão localmente (otimista) e confirma no servidor; em
  // caso de falha desfaz e avisa — mesmo padrão de moverSessao.
  async function redimensionarSessao(sessao: SessaoAgenda, novaDuracaoMin: number) {
    const anteriores = sessoes;
    setSessoes((prev) => prev.map((s) => (s.id === sessao.id ? { ...s, duracaoMin: novaDuracaoMin } : s)));
    try {
      const res = await fetch(`/api/sessoes/${sessao.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duracaoMin: novaDuracaoMin }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setSessoes(anteriores);
        mostrarAviso(data?.erro ?? "não foi possível alterar a duração");
        return;
      }
      await carregarSessoes();
    } catch {
      setSessoes(anteriores);
      mostrarAviso("não foi possível alterar a duração");
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const sessao = sessoes.find((s) => s.id === active.id);
    if (!sessao || !over) return;

    const diaIndex = Number(String(over.id).replace("dia-", ""));
    if (isNaN(diaIndex) || !dias[diaIndex]) return;

    const colEl = colRefs.current[diaIndex];
    const rectAtivo = active.rect.current.translated;
    if (!colEl || !rectAtivo) return;

    const rectCol = colEl.getBoundingClientRect();
    const offsetTopPx = rectAtivo.top - rectCol.top;
    const minutosRel = (offsetTopPx / rowPx) * ROW_MIN;
    const minutosSnap = Math.max(0, Math.round(minutosRel / 15) * 15);
    const novoMinutoAbsoluto = janela.inicioMin + minutosSnap;
    const novoHorario = minutosParaHora(novoMinutoAbsoluto);

    const diaAlvo = dias[diaIndex];
    const [hh, mm] = novoHorario.split(":").map(Number);
    const cDiaAlvo = componentesSP(diaAlvo);
    const novaData = criarDataSP(cDiaAlvo.ano, cDiaAlvo.mes, cDiaAlvo.dia, hh, mm);

    if (STATUS_TRAVADOS.includes(sessao.status)) return;

    if (novaData.getTime() < Date.now()) {
      mostrarAviso("Não é possível mover uma sessão para o passado.");
      return;
    }

    const diaSemanaAlvo = diaSemanaDeData(diaAlvo);
    const fimMin = novoMinutoAbsoluto + sessao.duracaoMin;
    if (!estaDentroExpediente(horarios, diaSemanaAlvo, novoMinutoAbsoluto, fimMin)) {
      mostrarAviso("Esse horário está fora do expediente da clínica.");
      return;
    }

    // A partir daqui a mutação é real (vai persistir) — trava o grid até
    // resolver. Se abrir o modal de escopo, o lock continua true: só
    // destrava quando o modal for respondido (onEscolher/onCancelar).
    travarMovimento();
    let vaiAbrirModal = false;
    try {
      // Só pergunta o escopo quando existe irmã futura elegível no mesmo
      // pacote — sem irmã, move direto (comportamento atual, sem fricção).
      // Consulta o banco (não o array `sessoes`, que só tem a semana visível
      // do calendário — a irmã seguinte, +7 dias, quase sempre cai fora dela).
      try {
        const res = await fetch(`/api/sessoes/${sessao.id}/irmas-futuras/`);
        if (!res.ok) throw new Error("falha ao consultar irmãs futuras");
        const data: { temFuturas: boolean; quantidade: number } = await res.json();
        if (data.temFuturas) {
          setEscopoPendente({ sessao, novaData, novoHorario, qtdIrmas: data.quantidade });
          vaiAbrirModal = true;
          return;
        }
      } catch (err) {
        // Em dúvida, move só a sessão arrastada — nunca aplica ESTA_E_FUTURAS
        // sem confirmação de que há irmã futura de fato.
        console.error("Falha ao consultar irmãs futuras da sessão:", err);
      }

      await moverSessao(sessao, novaData, novoHorario, "ESTA");
    } finally {
      if (!vaiAbrirModal) destravarMovimento();
    }
  }

  const titulo =
    modo === "semana"
      ? `${formatarDiaMes(dias[0])} – ${formatarDiaMes(dias[dias.length - 1])}`
      : dias[0].toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: TIMEZONE });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={irAnterior}
            aria-label="Período anterior"
            className="rounded-lg border border-border px-2.5 py-1.5 text-fg hover:bg-bg"
          >
            ‹
          </button>
          <button
            onClick={irHoje}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-bg"
          >
            Hoje
          </button>
          <button
            onClick={irProximo}
            aria-label="Próximo período"
            className="rounded-lg border border-border px-2.5 py-1.5 text-fg hover:bg-bg"
          >
            ›
          </button>
          <span className="ml-1 text-sm capitalize text-muted">{titulo}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setModo("semana")}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
              modo === "semana" ? "border-gold bg-gold/10 text-gold" : "border-border text-fg hover:bg-bg"
            }`}
          >
            Semana
          </button>
          <button
            onClick={() => setModo("dia")}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
              modo === "dia" ? "border-gold bg-gold/10 text-gold" : "border-border text-fg hover:bg-bg"
            }`}
          >
            Dia
          </button>
          <button
            onClick={() => setModalNovo(true)}
            className="rounded-lg border border-gold bg-gold/10 px-3 py-1.5 text-sm font-medium text-gold hover:bg-gold/20"
          >
            + Novo agendamento
          </button>
        </div>
      </div>

      {aviso && <p className="shrink-0 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{aviso}</p>}

      {carregando && sessoes.length === 0 ? (
        <p className="text-sm text-muted">Carregando agenda...</p>
      ) : erroSessoes ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-red/30 bg-red/10 p-8 text-center">
          <p className="text-sm text-red">Não foi possível carregar a agenda.</p>
          <button
            type="button"
            onClick={() => carregarSessoes()}
            className="rounded-lg border border-red px-4 py-1.5 text-sm font-medium text-red hover:bg-red/10"
          >
            Tentar novamente
          </button>
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="relative min-h-0 flex-1">
            <div
              ref={boxRef}
              className={`h-full min-h-0 overflow-auto rounded-xl border border-border bg-surface transition-opacity ${
                movendoSessao ? "pointer-events-none opacity-50" : ""
              }`}
            >
              <div className="flex" style={{ minWidth: modo === "semana" ? 1100 : 280 }}>
                {/* Gutter de horários */}
                <div className="w-14 shrink-0 border-r border-border">
                  <div className="sticky top-0 z-10 h-10 border-b border-border bg-surface" />
                  <div className="relative" style={{ height: gridHeightPx }}>
                    {marcadores.map((min) => (
                      <span
                        key={min}
                        className="absolute right-1.5 -translate-y-1/2 text-[10px] text-muted"
                        style={{ top: ((min - janela.inicioMin) / ROW_MIN) * rowPx }}
                      >
                        {minutosParaHora(min)}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="relative flex flex-1">
                  {semanaTemHoje && <LinhaHorarioAtual janela={janela} rowPx={rowPx} />}
                  {dias.map((dia, i) => (
                    <DiaColuna
                      key={i}
                      index={i}
                      dia={dia}
                      sessoesDoDia={sessoesPorDia[i]}
                      janela={janela}
                      marcadores={marcadores}
                      gridHeightPx={gridHeightPx}
                      rowPx={rowPx}
                      colRefCallback={(idx, node) => {
                        colRefs.current[idx] = node;
                      }}
                      onAbrirDetalhe={setSessaoDetalhe}
                      clinica={clinica}
                      agora={agora}
                      horarios={horarios}
                      onRedimensionar={redimensionarSessao}
                      onAviso={mostrarAviso}
                    />
                  ))}
                </div>
              </div>
            </div>
            {movendoSessao && (
              <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center">
                <span className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg shadow-md">
                  Salvando alteração...
                </span>
              </div>
            )}
          </div>
        </DndContext>
      )}

      {sessaoDetalhe && (
        <SessaoDetalheModal
          sessao={sessaoDetalhe}
          tiposSessao={tiposSessao}
          clinica={clinica}
          onFechar={() => setSessaoDetalhe(null)}
          onAtualizado={() => {
            carregarSessoes();
            setSessaoDetalhe(null);
          }}
          onAviso={mostrarAviso}
          onEditarPaciente={(pacienteId) => {
            setSessaoDetalhe(null);
            onEditarPaciente(pacienteId);
          }}
          onAbrirAnamnese={(pacienteId) => {
            setSessaoDetalhe(null);
            setAnamnesePacienteId(pacienteId);
          }}
          onAbrirEmpurrar={(pacienteId) => {
            setSessaoDetalhe(null);
            setEmpurrarPacienteId(pacienteId);
          }}
        />
      )}

      {anamnesePacienteId && (
        <AnamneseModal pacienteId={anamnesePacienteId} onFechar={() => setAnamnesePacienteId(null)} />
      )}

      {empurrarPacienteId && (
        <EmpurrarModal
          pacienteId={empurrarPacienteId}
          aberto={empurrarPacienteId !== null}
          onFechar={() => setEmpurrarPacienteId(null)}
          onSucesso={() => carregarSessoes()}
        />
      )}

      {escopoPendente && (
        <EscopoMoveModal
          sessao={escopoPendente.sessao}
          qtdIrmas={escopoPendente.qtdIrmas}
          onCancelar={() => {
            setEscopoPendente(null);
            destravarMovimento();
          }}
          onEscolher={async (escopo) => {
            const alvo = escopoPendente;
            setEscopoPendente(null);
            try {
              await moverSessao(alvo.sessao, alvo.novaData, alvo.novoHorario, escopo);
            } finally {
              destravarMovimento();
            }
          }}
        />
      )}

      {modalNovo && (
        <NovoAgendamentoModal
          tiposSessao={tiposSessao}
          mentoriaAtivada={clinica?.mentoriaAtivada ?? false}
          onFechar={() => setModalNovo(false)}
          onCriado={() => {
            setModalNovo(false);
            carregarSessoes();
          }}
        />
      )}
    </div>
  );
}

// Linha fina indicando o horário atual, atravessando todas as colunas da
// semana exibida — estado próprio (tick a cada 60s) pra não forçar o
// re-render do grid inteiro a cada minuto, como `agora` (em AgendaCalendario)
// já faz para esmaecer sessões passadas. Renderizada como irmã das
// `DiaColuna`, não mais dentro de uma coluna específica — por isso o `top`
// soma `ALTURA_CABECALHO_DIA`: o container-pai (o wrapper flex que envolve
// todas as colunas) começa no topo do cabeçalho de dia/data (h-10), não no
// topo da grade de horários como acontecia quando a linha vivia dentro do
// próprio corpo da coluna.
function LinhaHorarioAtual({
  janela,
  rowPx,
}: {
  janela: { inicioMin: number; fimMin: number };
  rowPx: number;
}) {
  const [instante, setInstante] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setInstante(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const c = componentesSP(instante);
  const minutosAtuais = c.hora * 60 + c.minuto;
  if (minutosAtuais < janela.inicioMin || minutosAtuais > janela.fimMin) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 border-t border-gold/30"
      style={{ top: ALTURA_CABECALHO_DIA + ((minutosAtuais - janela.inicioMin) / ROW_MIN) * rowPx }}
    />
  );
}

function DiaColuna({
  index,
  dia,
  sessoesDoDia,
  janela,
  marcadores,
  gridHeightPx,
  rowPx,
  colRefCallback,
  onAbrirDetalhe,
  clinica,
  agora,
  horarios,
  onRedimensionar,
  onAviso,
}: {
  index: number;
  dia: Date;
  sessoesDoDia: SessaoAgenda[];
  janela: { inicioMin: number; fimMin: number };
  marcadores: number[];
  gridHeightPx: number;
  rowPx: number;
  colRefCallback: (index: number, node: HTMLDivElement | null) => void;
  onAbrirDetalhe: (s: SessaoAgenda) => void;
  clinica: ClinicaAgenda | null;
  agora: number;
  horarios: HorarioTrabalho[];
  onRedimensionar: (sessao: SessaoAgenda, novaDuracaoMin: number) => void;
  onAviso: (msg: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `dia-${index}` });
  const hoje = mesmoDia(dia, new Date());

  // Sessões que caem no mesmo horário não podem ficar uma escondendo a
  // outra — divide o espaço horizontal entre as que se sobrepõem, como um
  // sinal visual de conflito/overbooking a revisar.
  const layoutColunas = useMemo(
    () =>
      calcularLayoutColunas(
        sessoesDoDia.map((s) => {
          const inicioMs = new Date(s.inicio).getTime();
          return { id: s.id, inicioMs, fimMs: inicioMs + s.duracaoMin * 60000 };
        })
      ),
    [sessoesDoDia]
  );

  return (
    <div className="min-w-[150px] flex-1 border-r border-border last:border-r-0">
      <div
        className={`sticky top-0 z-10 flex h-10 flex-col items-center justify-center border-b border-border bg-surface text-xs ${
          hoje ? "font-semibold text-gold" : "text-fg"
        }`}
      >
        <span>{diaSemanaLabel(diaSemanaDeData(dia))}</span>
        <span className="text-[10px] text-muted">{formatarDiaMes(dia)}</span>
      </div>
      <div
        ref={(node) => {
          setNodeRef(node);
          colRefCallback(index, node);
        }}
        className={`relative ${isOver ? "bg-gold/5" : ""}`}
        style={{ height: gridHeightPx }}
      >
        {marcadores.map((min) => (
          <div
            key={min}
            className="absolute inset-x-0 border-t border-border/60"
            style={{ top: ((min - janela.inicioMin) / ROW_MIN) * rowPx }}
          />
        ))}
        {sessoesDoDia.map((s) => (
          <BlocoSessao
            key={s.id}
            sessao={s}
            janela={janela}
            rowPx={rowPx}
            onAbrirDetalhe={onAbrirDetalhe}
            clinica={clinica}
            agora={agora}
            layout={layoutColunas.get(s.id) ?? { coluna: 0, totalColunas: 1 }}
            horarios={horarios}
            onRedimensionar={onRedimensionar}
            onAviso={onAviso}
          />
        ))}
      </div>
    </div>
  );
}

function BlocoSessao({
  sessao,
  janela,
  rowPx,
  onAbrirDetalhe,
  clinica,
  agora,
  layout,
  horarios,
  onRedimensionar,
  onAviso,
}: {
  sessao: SessaoAgenda;
  janela: { inicioMin: number; fimMin: number };
  rowPx: number;
  onAbrirDetalhe: (s: SessaoAgenda) => void;
  clinica: ClinicaAgenda | null;
  agora: number;
  layout: LayoutColuna;
  horarios: HorarioTrabalho[];
  onRedimensionar: (sessao: SessaoAgenda, novaDuracaoMin: number) => void;
  onAviso: (msg: string) => void;
}) {
  const travada = STATUS_TRAVADOS.includes(sessao.status);
  const [previewDuracaoMin, setPreviewDuracaoMin] = useState<number | null>(null);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: sessao.id,
    disabled: travada,
  });

  const [copiado, setCopiado] = useState<"conf" | "meet" | null>(null);
  const copiadoTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inicio = new Date(sessao.inicio);
  const fim = new Date(inicio.getTime() + sessao.duracaoMin * 60000);
  const cInicio = componentesSP(inicio);
  const minutos = cInicio.hora * 60 + cInicio.minuto;
  const top = ((minutos - janela.inicioMin) / ROW_MIN) * rowPx;
  // Enquanto o mouse está arrastando a borda inferior, a altura reflete a
  // duração-preview (ainda não confirmada no servidor) em vez da real.
  const duracaoExibida = previewDuracaoMin ?? sessao.duracaoMin;
  // Altura proporcional pura (sem piso/desconto aqui) — GAP é descontado
  // ANTES da comparação com FRESTA_MIN no style.height, pra o vão abaixo do
  // card sair sempre igual a GAP, em qualquer duração que não bata no piso.
  const altura = (duracaoExibida / ROW_MIN) * rowPx;
  const cor = sessao.tipoSessao?.cor ?? "#c9a96e";
  // Sessão cujo horário de início já passou fica esmaecida, igual Google Agenda — independe do status
  const jaComecou = inicio.getTime() < agora;

  // Duas ou mais sessões no mesmo horário dividem o espaço horizontal lado a
  // lado, em vez de ficarem uma escondendo a outra — sinal visual de
  // conflito/overbooking a revisar.
  const sobreposta = layout.totalColunas > 1;
  const larguraPercent = 100 / layout.totalColunas;

  const style: React.CSSProperties = {
    top,
    height: Math.max(FRESTA_MIN, altura - GAP),
    backgroundColor: cor,
    opacity: jaComecou ? 0.5 : 1,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    zIndex: isDragging ? 20 : 1,
    cursor: travada ? "default" : "grab",
    ...(sobreposta
      ? {
          left: `calc(${larguraPercent * layout.coluna}% + 2px)`,
          width: `calc(${larguraPercent}% - 4px)`,
        }
      : {}),
  };

  function mostrarCopiado(tipo: "conf" | "meet") {
    setCopiado(tipo);
    if (copiadoTimeout.current) clearTimeout(copiadoTimeout.current);
    copiadoTimeout.current = setTimeout(() => setCopiado(null), 1500);
  }

  async function handleCopiarConfirmacao(e: React.SyntheticEvent) {
    e.stopPropagation();
    if (!clinica) return;
    if (await copiarParaClipboard(montarMensagemConfirmacao(sessao, clinica))) mostrarCopiado("conf");
  }

  async function handleCopiarMeet(e: React.SyntheticEvent) {
    e.stopPropagation();
    if (!sessao.linkMeet || !clinica) return;
    if (await copiarParaClipboard(montarMensagemMeetCalendario(sessao, clinica))) mostrarCopiado("meet");
  }

  // Redimensiona a duração arrastando a borda inferior do bloco. Evento
  // tratado fora do dnd-kit (stopPropagation impede que o drag de mover
  // comece junto) — pointermove/pointerup ficam no window para acompanhar o
  // ponteiro mesmo saindo da área do bloco.
  function handleResizePointerDown(e: React.PointerEvent) {
    if (travada) return;
    e.stopPropagation();
    e.preventDefault();

    const startY = e.clientY;
    const duracaoInicial = sessao.duracaoMin;

    function calcularCandidato(ev: PointerEvent) {
      const deltaY = ev.clientY - startY;
      const deltaMin = Math.round((deltaY / rowPx) * ROW_MIN / DURACAO_SNAP_MIN) * DURACAO_SNAP_MIN;
      return Math.max(DURACAO_SNAP_MIN, duracaoInicial + deltaMin);
    }

    function onMove(ev: PointerEvent) {
      setPreviewDuracaoMin(calcularCandidato(ev));
    }

    function onUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setPreviewDuracaoMin(null);

      const candidato = calcularCandidato(ev);
      if (candidato === duracaoInicial) return;

      const diaSemanaNome = DIA_SEMANA_POR_INDICE[cInicio.diaSemana];
      const fimMin = minutos + candidato;
      if (!estaDentroExpediente(horarios, diaSemanaNome, minutos, fimMin)) {
        onAviso("Essa duração ultrapassa o expediente da clínica.");
        return;
      }

      onRedimensionar(sessao, candidato);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      ref={setNodeRef}
      {...(travada ? {} : listeners)}
      {...(travada ? {} : attributes)}
      role="button"
      tabIndex={0}
      onClick={() => onAbrirDetalhe(sessao)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAbrirDetalhe(sessao);
        }
      }}
      style={style}
      title={`${nomeDaSessao(sessao)} — ${sessao.tipoSessao?.nome ?? "Sessão"} (${statusLabel(sessao.status)})`}
      className={`absolute ${sobreposta ? "" : "left-1 right-1"} flex items-center justify-between gap-1 overflow-hidden rounded-md px-1.5 py-0 text-left text-white shadow-sm`}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate text-[11px] font-medium leading-none">
          {sessao.aluno
            ? `${nomeDaSessao(sessao).split(" ")[0]} (FonoElite)${sessao.confirmada ? " ✅" : ""}`
            : textoLinhaBlocoAgenda(
                nomeDaSessao(sessao),
                sessao.numeroSessao ?? 0,
                sessao.totalPacote ?? 0,
                sessao.confirmada,
                sessao.tipoSessao?.ehAtendimentoUnico ?? false,
                sessao.tipoSessao?.nome ?? null
              )}
        </p>
        {copiado ? (
          <p className="truncate text-[11px] font-medium leading-none">Copiado!</p>
        ) : (
          <p className="truncate text-[11px] leading-none opacity-90">
            {formatarHorario(inicio)}–{formatarHorario(fim)}
          </p>
        )}
      </div>
      {/* Coluna direita — os 3 botões, centralizados verticalmente pelo
          items-center da raiz, sem disputar espaço com o texto (que trunca
          na coluna esquerda via min-w-0/flex-1). */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleCopiarConfirmacao}
          title="Copiar mensagem de confirmação"
          aria-label="Copiar mensagem de confirmação"
          className="rounded-full bg-white/25 p-1 shadow-sm backdrop-blur-[1px] hover:bg-white/40"
        >
          <IconCopiar className="h-3 w-3" />
        </button>
        <button
          type="button"
          disabled={!sessao.linkMeet}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleCopiarMeet}
          title="Copiar texto do link do Meet"
          aria-label="Copiar texto do link do Meet"
          className="rounded-full bg-white/25 p-1 shadow-sm backdrop-blur-[1px] hover:bg-white/40 disabled:cursor-not-allowed disabled:bg-white/10 disabled:opacity-40 disabled:shadow-none disabled:hover:bg-white/10"
        >
          <IconLink className="h-3 w-3" />
        </button>
        <button
          type="button"
          disabled={!sessao.linkMeet}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (sessao.linkMeet) window.open(sessao.linkMeet, "_blank", "noopener,noreferrer");
          }}
          title="Abrir Meet"
          aria-label="Abrir Meet"
          className="rounded-full bg-white/25 p-1 shadow-sm backdrop-blur-[1px] hover:bg-white/40 disabled:cursor-not-allowed disabled:bg-white/10 disabled:opacity-40 disabled:shadow-none disabled:hover:bg-white/10"
        >
          <IconMeet className="h-3 w-3" />
        </button>
      </div>

      {!travada && clinica?.permitirResizeSessao && (
        <div
          onPointerDown={handleResizePointerDown}
          onClick={(e) => e.stopPropagation()}
          title="Arraste para alterar a duração"
          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
          style={{ touchAction: "none" }}
        />
      )}
    </div>
  );
}

// Ícone de copiar (clipboard), usado nos botões de copiar do bloco de sessão
function IconCopiar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <rect x="7" y="7" width="9" height="10" rx="1.3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4 13V4.5A1.5 1.5 0 0 1 5.5 3H13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconLink({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-1 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M11.5 8.5a3 3 0 0 0-4.2 0L5 10.8a3 3 0 0 0 4.2 4.2l1-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

// Ícone de vídeo (Meet), usado no botão de copiar o link da chamada
function IconMeet({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <rect x="2.5" y="5.5" width="10" height="9" rx="1.3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M12.5 9.2 17 6.3v7.4l-4.5-2.9" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

// Ícone de prancheta (anamnese) — mesmo desenho usado no botão "Anamnese" do
// painel lateral de pacientes, pra manter o mesmo padrão visual no projeto
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

// Modal aberto ao soltar um drag de sessão que tem irmã futura elegível no
// mesmo pacote — pergunta se a mudança de dia/horário vale só para a sessão
// arrastada ou também realinha as seguintes, antes de persistir qualquer coisa.
const TIPOS_PACOTE_OPCOES = ["AVULSA", "MENSAL", "BIMESTRAL", "TRIMESTRAL", "PERSONALIZADO"] as const;
const TIPO_PACOTE_LABEL: Record<string, string> = {
  AVULSA: "Avulsa", MENSAL: "Mensal", BIMESTRAL: "Bimestral", TRIMESTRAL: "Trimestral", PERSONALIZADO: "Personalizado",
};

function mascararHorarioAgenda(valor: string) {
  const digitos = valor.replace(/\D/g, "").slice(0, 4);
  return digitos.length > 2 ? `${digitos.slice(0, 2)}:${digitos.slice(2)}` : digitos;
}

// Modal "Novo agendamento" — ponto de entrada único na grade pra criar
// sessão de Paciente OU reunião avulsa de Mentorado. Paciente reusa
// exatamente POST /api/pacotes (mesmo fluxo do painel do paciente, sem
// alteração); Mentorado usa POST /api/agendamentos/mentoria (Fase 3) — mesma
// engine de Google Calendar/Meet nos dois casos, cada rota já cuida disso.
function NovoAgendamentoModal({
  tiposSessao,
  mentoriaAtivada,
  onFechar,
  onCriado,
}: {
  tiposSessao: TipoSessaoOpcao[];
  mentoriaAtivada: boolean;
  onFechar: () => void;
  onCriado: () => void;
}) {
  const [tipo, setTipo] = useState<"PACIENTE" | "MENTORADO" | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  // --- campos comuns ---
  const [dataInicial, setDataInicial] = useState("");
  const [horario, setHorario] = useState("");
  const [tipoSessaoId, setTipoSessaoId] = useState("");

  // --- Paciente ---
  const [buscaPaciente, setBuscaPaciente] = useState("");
  const [opcoesPaciente, setOpcoesPaciente] = useState<PacienteOpcao[]>([]);
  const [pacienteEscolhido, setPacienteEscolhido] = useState<PacienteOpcao | null>(null);
  const [tipoPacote, setTipoPacote] = useState<string>(TIPOS_PACOTE_OPCOES[0]);
  const [totalSessoes, setTotalSessoes] = useState("");

  // --- Mentorado ---
  const [opcoesAluno, setOpcoesAluno] = useState<AlunoOpcao[]>([]);
  const [alunoId, setAlunoId] = useState("");
  const [duracaoMentorado, setDuracaoMentorado] = useState(45);

  useEffect(() => {
    if (tipo !== "PACIENTE") return;
    const buscaLimpa = buscaPaciente.trim();
    if (!buscaLimpa) {
      setOpcoesPaciente([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/pacientes?busca=${encodeURIComponent(buscaLimpa)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then(setOpcoesPaciente)
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [tipo, buscaPaciente]);

  useEffect(() => {
    if (tipo !== "MENTORADO") return;
    fetch("/api/mentoria/alunos")
      .then((r) => (r.ok ? r.json() : []))
      .then(setOpcoesAluno)
      .catch(() => {});
  }, [tipo]);

  const tipoSessaoEhUnico = tiposSessao.find((t) => t.id === tipoSessaoId)?.ehAtendimentoUnico ?? false;

  async function handleCriarPaciente(e: React.FormEvent) {
    e.preventDefault();
    if (!pacienteEscolhido) {
      setErro("selecione um paciente");
      return;
    }
    if (!dataInicial || !horario) {
      setErro("informe o dia e o horário da 1ª sessão");
      return;
    }
    if (!tipoSessaoId) {
      setErro("informe o tipo de atendimento");
      return;
    }
    setErro("");
    setSalvando(true);
    try {
      const body: Record<string, unknown> = {
        pacienteId: pacienteEscolhido.id,
        tipo: tipoPacote,
        dataInicial,
        horario,
        tipoSessaoId,
      };
      if (tipoPacote === "PERSONALIZADO") body.totalSessoes = Number(totalSessoes);

      const res = await fetch("/api/pacotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErro(data?.erro ?? "não foi possível criar o atendimento");
        return;
      }
      onCriado();
    } finally {
      setSalvando(false);
    }
  }

  async function handleCriarMentorado(e: React.FormEvent) {
    e.preventDefault();
    if (!alunoId) {
      setErro("selecione um mentorado");
      return;
    }
    if (!dataInicial || !horario) {
      setErro("informe o dia e o horário da reunião");
      return;
    }
    setErro("");
    setSalvando(true);
    try {
      const res = await fetch("/api/agendamentos/mentoria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alunoId,
          dataInicial,
          horario,
          duracaoMin: duracaoMentorado,
          tipoSessaoId: tipoSessaoId || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErro(data?.erro ?? "não foi possível criar a reunião");
        return;
      }
      onCriado();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="font-serif text-lg font-semibold text-fg">Novo agendamento</h2>
          <button onClick={onFechar} className="text-muted hover:text-fg" aria-label="Fechar">
            ✕
          </button>
        </div>

        {tipo === null && (
          <div className="space-y-2">
            <button
              onClick={() => setTipo("PACIENTE")}
              className="w-full rounded-lg border border-border px-4 py-3 text-left text-sm font-medium text-fg hover:bg-bg"
            >
              Paciente
              <span className="mt-0.5 block text-xs font-normal text-muted">Sessão de atendimento (avulsa ou em pacote)</span>
            </button>
            <button
              onClick={() => mentoriaAtivada && setTipo("MENTORADO")}
              disabled={!mentoriaAtivada}
              className="w-full rounded-lg border border-border px-4 py-3 text-left text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
            >
              Mentorado
              <span className="mt-0.5 block text-xs font-normal text-muted">
                {mentoriaAtivada ? "Reunião avulsa de mentoria" : "Módulo Mentoria não está ativado nesta clínica"}
              </span>
            </button>
          </div>
        )}

        {tipo === "PACIENTE" && (
          <form onSubmit={handleCriarPaciente} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-fg">Paciente</label>
              {pacienteEscolhido ? (
                <div className="flex items-center justify-between rounded-lg border border-border bg-bg px-3 py-2">
                  <span className="text-sm text-fg">{pacienteEscolhido.nome}</span>
                  <button
                    type="button"
                    onClick={() => setPacienteEscolhido(null)}
                    className="text-xs font-medium text-gold hover:underline"
                  >
                    trocar
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    autoFocus
                    placeholder="buscar por nome..."
                    value={buscaPaciente}
                    onChange={(e) => setBuscaPaciente(e.target.value)}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  />
                  {opcoesPaciente.length > 0 && (
                    <ul className="mt-1 max-h-40 overflow-auto rounded-lg border border-border">
                      {opcoesPaciente.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setPacienteEscolhido(p);
                              setOpcoesPaciente([]);
                            }}
                            className="w-full px-3 py-2 text-left text-sm text-fg hover:bg-bg"
                          >
                            {p.nome}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-fg">Tipo de atendimento</label>
              {tiposSessao.length === 0 ? (
                <p className="text-sm text-muted">Nenhum tipo de atendimento cadastrado.</p>
              ) : (
                <select
                  value={tipoSessaoId}
                  onChange={(e) => {
                    setTipoSessaoId(e.target.value);
                    const t = tiposSessao.find((ts) => ts.id === e.target.value);
                    if (t?.ehAtendimentoUnico) setTipoPacote(TIPOS_PACOTE_OPCOES[0]);
                  }}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                >
                  <option value="">selecione...</option>
                  {tiposSessao.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-fg">Recorrência</label>
              <select
                value={tipoPacote}
                onChange={(e) => setTipoPacote(e.target.value)}
                disabled={tipoSessaoEhUnico}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {(tipoSessaoEhUnico ? [TIPOS_PACOTE_OPCOES[0]] : TIPOS_PACOTE_OPCOES).map((t) => (
                  <option key={t} value={t}>
                    {TIPO_PACOTE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>

            {tipoPacote === "PERSONALIZADO" && (
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Total de sessões</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={totalSessoes}
                  onChange={(e) => setTotalSessoes(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block whitespace-nowrap text-sm font-medium text-fg">Dia da 1ª sessão</label>
                <DatePickerSP value={dataInicial} onChange={setDataInicial} />
              </div>
              <div>
                <label className="mb-1 block whitespace-nowrap text-sm font-medium text-fg">Horário</label>
                <input
                  type="text"
                  required
                  placeholder="14:00"
                  pattern="^([01]\d|2[0-3]):[0-5]\d$"
                  value={horario}
                  onChange={(e) => setHorario(mascararHorarioAgenda(e.target.value))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
            </div>

            {erro && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erro}</p>}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setTipo(null)}
                disabled={salvando}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                Voltar
              </button>
              <button
                type="submit"
                disabled={salvando}
                className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-white hover:bg-gold/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {salvando ? "Criando..." : "Criar atendimento"}
              </button>
            </div>
          </form>
        )}

        {tipo === "MENTORADO" && (
          <form onSubmit={handleCriarMentorado} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-fg">Mentorado</label>
              {opcoesAluno.length === 0 ? (
                <p className="text-sm text-muted">Nenhum aluno cadastrado em Mentoria → Alunos.</p>
              ) : (
                <select
                  value={alunoId}
                  onChange={(e) => setAlunoId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                >
                  <option value="">selecione...</option>
                  {opcoesAluno.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nomeCompleto}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-fg">Tipo de atendimento (opcional)</label>
              <select
                value={tipoSessaoId}
                onChange={(e) => setTipoSessaoId(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
              >
                <option value="">sem tipo</option>
                {tiposSessao.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block whitespace-nowrap text-sm font-medium text-fg">Dia</label>
                <DatePickerSP value={dataInicial} onChange={setDataInicial} />
              </div>
              <div>
                <label className="mb-1 block whitespace-nowrap text-sm font-medium text-fg">Horário</label>
                <input
                  type="text"
                  required
                  placeholder="14:00"
                  pattern="^([01]\d|2[0-3]):[0-5]\d$"
                  value={horario}
                  onChange={(e) => setHorario(mascararHorarioAgenda(e.target.value))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-fg">Duração (min)</label>
              <select
                value={duracaoMentorado}
                onChange={(e) => setDuracaoMentorado(Number(e.target.value))}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
              >
                {[30, 45, 60, 90, 120].map((min) => (
                  <option key={min} value={min}>
                    {min} min
                  </option>
                ))}
              </select>
            </div>

            {erro && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erro}</p>}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setTipo(null)}
                disabled={salvando}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                Voltar
              </button>
              <button
                type="submit"
                disabled={salvando}
                className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-white hover:bg-gold/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {salvando ? "Criando..." : "Criar reunião"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function EscopoMoveModal({
  sessao,
  qtdIrmas,
  onCancelar,
  onEscolher,
}: {
  sessao: SessaoAgenda;
  qtdIrmas: number;
  onCancelar: () => void;
  onEscolher: (escopo: EscopoMove) => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
        <h2 className="mb-2 font-serif text-lg font-semibold text-fg">Mover sessões futuras?</h2>
        <p className="mb-4 text-sm text-muted">
          A sessão {sessao.numeroSessao}/{sessao.totalPacote} de {nomeDaSessao(sessao)} faz parte de um pacote com{" "}
          {qtdIrmas} sessão{qtdIrmas > 1 ? "ões" : ""} seguinte{qtdIrmas > 1 ? "s" : ""}. “Esta e as futuras”
          realinha todas as seguintes para o novo dia e horário, mantendo a cadência semanal.
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => onEscolher("ESTA_E_FUTURAS")}
            className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110"
          >
            Esta e as futuras
          </button>
          <button
            onClick={() => onEscolher("ESTA")}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg"
          >
            Somente esta
          </button>
          <button onClick={onCancelar} className="rounded-lg px-4 py-2 text-sm font-medium text-muted hover:bg-bg">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// Modal de detalhes da sessão, aberto ao clicar num bloco do calendário —
// mesmas ações já existentes no painel do paciente (status, editar, cancelar),
// numa versão compacta para não sair do contexto da agenda.
function SessaoDetalheModal({
  sessao,
  tiposSessao,
  clinica,
  onFechar,
  onAtualizado,
  onAviso,
  onEditarPaciente,
  onAbrirAnamnese,
  onAbrirEmpurrar,
}: {
  sessao: SessaoAgenda;
  tiposSessao: TipoSessaoOpcao[];
  clinica: ClinicaAgenda | null;
  onFechar: () => void;
  onAtualizado: () => void;
  onAviso: (msg: string) => void;
  onEditarPaciente: (pacienteId: string) => void;
  onAbrirAnamnese: (pacienteId: string) => void;
  onAbrirEmpurrar: (pacienteId: string) => void;
}) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [editando, setEditando] = useState(false);
  const [novaData, setNovaData] = useState(dataISODeData(new Date(sessao.inicio)));
  const [novoHorario, setNovoHorario] = useState(formatarHorario(new Date(sessao.inicio)));
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [arquivar, setArquivar] = useState(false);
  const [trocandoTipo, setTrocandoTipo] = useState(false);
  const [novoTipoId, setNovoTipoId] = useState(sessao.tipoSessaoId ?? "");
  const [alterandoDuracao, setAlterandoDuracao] = useState(false);
  const [novaDuracao, setNovaDuracao] = useState(sessao.duracaoMin);
  const [copiado, setCopiado] = useState<"conf" | "meet" | null>(null);
  const copiadoTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const travada = STATUS_TRAVADOS.includes(sessao.status);
  const inicio = new Date(sessao.inicio);

  function mostrarCopiado(tipo: "conf" | "meet") {
    setCopiado(tipo);
    if (copiadoTimeout.current) clearTimeout(copiadoTimeout.current);
    copiadoTimeout.current = setTimeout(() => setCopiado(null), 1500);
  }

  async function handleCopiarConfirmacao() {
    if (!clinica) return;
    if (await copiarParaClipboard(montarMensagemConfirmacao(sessao, clinica))) mostrarCopiado("conf");
  }

  async function handleCopiarMeet() {
    if (!sessao.linkMeet || !clinica) return;
    if (await copiarParaClipboard(montarMensagemMeetCalendario(sessao, clinica))) mostrarCopiado("meet");
  }

  async function alternarConfirmacao() {
    setErro("");
    setSalvando(true);
    try {
      const res = await fetch(`/api/sessoes/${sessao.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmada: !sessao.confirmada }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErro(data?.erro ?? "não foi possível atualizar a confirmação");
        return;
      }
      onAtualizado();
    } finally {
      setSalvando(false);
    }
  }

  async function handleTrazer() {
    if (!sessao.pacienteId) return;
    setErro("");
    setSalvando(true);
    try {
      const res = await fetch(`/api/pacientes/${sessao.pacienteId}/adiar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessaoCorteId: sessao.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErro(data?.erro ?? "não foi possível trazer as sessões");
        return;
      }
      onAtualizado();
    } finally {
      setSalvando(false);
    }
  }

  async function mudarStatus(novoStatus: string) {
    if (travada) {
      const ok = window.confirm(
        `Esta sessão está marcada como "${statusLabel(sessao.status)}". Deseja alterar para "${statusLabel(novoStatus)}"?`
      );
      if (!ok) return;
    }
    setErro("");
    setSalvando(true);
	
    try {
      const res = await fetch(`/api/sessoes/${sessao.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: novoStatus }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErro(data?.erro ?? "não foi possível atualizar a sessão");
        return;
      }
      onAtualizado();
    } finally {
      setSalvando(false);
    }
  }

  async function salvarEdicao(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setSalvando(true);
    try {
      const res = await fetch(`/api/sessoes/${sessao.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novaData, novoHorario }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErro(data?.erro ?? "não foi possível editar a sessão");
        return;
      }
      onAtualizado();
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarCancelamento(e: React.FormEvent) {
    e.preventDefault();
    const motivoLimpo = motivo.trim();
    if (!motivoLimpo) {
      setErro("informe o motivo do cancelamento");
      return;
    }
    setErro("");
    setSalvando(true);
    try {
      const res = await fetch(`/api/sessoes/${sessao.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELADA", motivoCancelamento: motivoLimpo, arquivar }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErro(data?.erro ?? "não foi possível cancelar a sessão");
        return;
      }
      onAtualizado();
    } finally {
      setSalvando(false);
    }
  }

  async function salvarTipo(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setSalvando(true);
    try {
      const res = await fetch(`/api/sessoes/${sessao.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipoSessaoId: novoTipoId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErro(data?.erro ?? "não foi possível trocar o tipo de atendimento");
        return;
      }
      if (data?.avisoMeet) onAviso(data.avisoMeet);
      onAtualizado();
    } finally {
      setSalvando(false);
    }
  }

  async function salvarDuracao(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setSalvando(true);
    try {
      const res = await fetch(`/api/sessoes/${sessao.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duracaoMin: novaDuracao }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErro(data?.erro ?? "não foi possível alterar a duração");
        return;
      }
      onAtualizado();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="font-serif text-lg font-semibold text-fg">{nomeDaSessao(sessao)}</h2>
            <p className="text-sm text-muted">
              {sessao.aluno
                ? `Reunião de mentoria — ${sessao.tipoSessao?.nome ?? "Sem tipo"}`
                : `Sessão ${sessao.numeroSessao}/${sessao.totalPacote} — ${sessao.tipoSessao?.nome ?? "Sem tipo"}`}
            </p>
            <p className="text-sm text-muted">
              {inicio.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: TIMEZONE })} às{" "}
              {formatarHorario(inicio)}
            </p>
          </div>
          <button onClick={onFechar} className="text-muted hover:text-fg" aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${corPontoStatus(sessao.status)}`} />
          <span className="text-sm text-fg">{statusLabel(sessao.status)}</span>
        </div>

        {!travada && (
          <label className="mb-4 flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={sessao.confirmada}
              disabled={salvando}
              onChange={alternarConfirmacao}
              className="h-4 w-4 rounded border-border disabled:cursor-not-allowed disabled:opacity-60"
            />
            Sessão confirmada
          </label>
        )}

        {sessao.status === "CANCELADA" && sessao.motivoCancelamento && (
          <p className="mb-4 rounded-lg bg-bg px-3 py-2 text-xs italic text-muted">f
            Motivo: {sessao.motivoCancelamento}
          </p>
        )}

        {erro && <p className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erro}</p>}

        {!editando && !cancelando && !trocandoTipo && !alterandoDuracao && (
          <div className="space-y-4">
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Status</p>
              <div className="grid grid-cols-2 gap-1.5">
                {STATUS_SESSAO_OPCOES.map((st) => (
                  <button
                    key={st}
                    disabled={salvando}
                    onClick={() => mudarStatus(st)}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60 ${
                      st === sessao.status
                        ? "border-gold bg-gold/10 text-gold"
                        : "border-border text-fg hover:bg-bg"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${corPontoStatus(st)}`} />
                    {statusLabel(st)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setEditando(true)}
                className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-bg"
              >
                Editar data/horário
              </button>
              <button
                onClick={() => {
                  setNovoTipoId(sessao.tipoSessaoId ?? "");
                  setTrocandoTipo(true);
                }}
                className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-bg"
              >
                Trocar tipo
              </button>
              <button
                onClick={() => {
                  setNovaDuracao(sessao.duracaoMin);
                  setAlterandoDuracao(true);
                }}
                className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-bg"
              >
                Duração
              </button>
              {sessao.pacienteId && (
                <button
                  onClick={() => onEditarPaciente(sessao.pacienteId!)}
                  className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-bg"
                >
                  Editar paciente
                </button>
              )}
              {sessao.pacienteId && (
                <button
                  disabled={salvando}
                  onClick={handleTrazer}
                  className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Trazer
                </button>
              )}
              {sessao.pacienteId && (
                <button
                  onClick={() => onAbrirEmpurrar(sessao.pacienteId!)}
                  className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-bg"
                >
                  Empurrar
                </button>
              )}
              <button
                onClick={() => {
                  setMotivo("");
                  setArquivar(false);
                  setCancelando(true);
                }}
                className="flex-1 rounded-lg border border-red px-3 py-1.5 text-sm font-medium text-red hover:bg-red/10"
              >
                Cancelar sessão
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleCopiarConfirmacao}
                className="rounded-lg border border-whatsapp px-2 py-1 text-sm text-whatsapp hover:bg-whatsapp/10"
              >
                {copiado === "conf" ? "Copiado!" : "Copiar confirmação"}
              </button>
              <button
                onClick={handleCopiarMeet}
                disabled={!sessao.linkMeet}
                title={!sessao.linkMeet ? "Sessão sem link do Meet" : undefined}
                className="rounded-lg border border-whatsapp px-2 py-1 text-sm text-whatsapp hover:bg-whatsapp/10 disabled:cursor-not-allowed disabled:border-border disabled:text-muted disabled:opacity-40 disabled:hover:bg-transparent"
              >
                {copiado === "meet" ? "Copiado!" : "Copiar link Meet"}
              </button>
              {sessao.pacienteId && (
                <button
                  onClick={() => onAbrirAnamnese(sessao.pacienteId!)}
                  className="flex items-center gap-1.5 rounded-lg border border-gold px-2 py-1 text-sm font-medium text-gold hover:bg-gold/10"
                >
                  <IconPrancheta className="h-3.5 w-3.5" />
                  Anamnese
                </button>
              )}
            </div>
          </div>
        )}

        {editando && (
          <form onSubmit={salvarEdicao} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-fg">Nova data</label>
              <DatePickerSP value={novaData} onChange={setNovaData} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-fg">Novo horário (HH:MM)</label>
              <input
                type="text"
                required
                placeholder="14:00"
                pattern="^([01]\d|2[0-3]):[0-5]\d$"
                value={novoHorario}
                onChange={(e) => setNovoHorario(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
              />
            </div>
            <p className="text-xs text-muted">
              Qualquer data e horário (08:00–19:30), desde que não caia na mesma semana de outra sessão deste paciente.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditando(false)}
                disabled={salvando}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                Voltar
              </button>
              <button
                type="submit"
                disabled={salvando || !novaData || !novoHorario}
                className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {salvando ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </form>
        )}

        {trocandoTipo && (
          <form onSubmit={salvarTipo} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-fg">Tipo de atendimento</label>
              <div className="flex flex-wrap gap-1.5">
                {tiposSessao.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setNovoTipoId(t.id)}
                    className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${
                      t.id === novoTipoId ? "border-gold bg-gold/10 text-gold" : "border-border text-fg hover:bg-bg"
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.cor ?? "#c9a96e" }} />
                    {t.nome}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setTrocandoTipo(false)}
                disabled={salvando}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                Voltar
              </button>
              <button
                type="submit"
                disabled={salvando || !novoTipoId || novoTipoId === sessao.tipoSessaoId}
                className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {salvando ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </form>
        )}

        {alterandoDuracao && (
          <form onSubmit={salvarDuracao} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-fg">Duração (minutos)</label>
              <div className="flex flex-wrap gap-1.5">
                {DURACAO_OPCOES_MIN.map((min) => (
                  <button
                    key={min}
                    type="button"
                    onClick={() => setNovaDuracao(min)}
                    className={`rounded-lg border px-3 py-1.5 text-xs ${
                      min === novaDuracao ? "border-gold bg-gold/10 text-gold" : "border-border text-fg hover:bg-bg"
                    }`}
                  >
                    {min} min
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={DURACAO_SNAP_MIN}
                step={DURACAO_SNAP_MIN}
                value={novaDuracao}
                onChange={(e) => setNovaDuracao(Number(e.target.value))}
                className="mt-2 w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
              />
            </div>
            <p className="text-xs text-muted">
              Múltiplo de {DURACAO_SNAP_MIN} minutos, sem ultrapassar o expediente da clínica.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setAlterandoDuracao(false)}
                disabled={salvando}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                Voltar
              </button>
              <button
                type="submit"
                disabled={
                  salvando ||
                  !Number.isInteger(novaDuracao) ||
                  novaDuracao < DURACAO_SNAP_MIN ||
                  novaDuracao % DURACAO_SNAP_MIN !== 0 ||
                  novaDuracao === sessao.duracaoMin
                }
                className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {salvando ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </form>
        )}

        {cancelando && (
          <form onSubmit={confirmarCancelamento} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-fg">Motivo do cancelamento</label>
              <textarea
                required
                rows={3}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Descreva o motivo do cancelamento..."
                className="w-full resize-none rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none placeholder:text-muted focus:border-gold focus:ring-2 focus:ring-gold/20"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={arquivar}
                onChange={(e) => setArquivar(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Arquivar sessão (some do cadastro e da agenda)
            </label>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setCancelando(false)}
                disabled={salvando}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                Voltar
              </button>
              <button
                type="submit"
                disabled={salvando || !motivo.trim()}
                className="rounded-lg bg-red px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {salvando ? "Cancelando..." : "Confirmar cancelamento"}
              </button>
            </div>
          </form>
        )}

        
      </div>
    </div>
  );
}
