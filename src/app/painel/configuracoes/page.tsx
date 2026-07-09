"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { diaSemanaLabel } from "@/lib/labels";
import { AJUSTE_FUNDO_PADRAO, OPCOES_AJUSTE_FUNDO, estiloFundoTela } from "@/lib/fundo";

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
  nomeExibicao: string | null;
  logo: string | null;
  fundoUrl: string | null;
  fundoOpacidade: number;
  fundoAjuste: string;
  corPrimaria: string | null;
  corSecundaria: string | null;
  duracaoPadraoMin: number;
  nomeAssistente: string;
  horarioLimiteConfirmacao: string;
  permitirResizeSessao: boolean;
  pastaRaizDriveId: string | null;
  emailBoasVindasAssunto: string;
  emailBoasVindasCorpo: string;
  templateConfirmacao: string;
  templateMeet: string;
  sheetsPlanilhaId: string | null;
  sheetsAba: string | null;
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
  const [importandoPacientes, setImportandoPacientes] = useState(false);
  const [importarErro, setImportarErro] = useState("");
  const [importarSucesso, setImportarSucesso] = useState<{ importados: number; ignorados: number; erros: number } | null>(null);
  const [confirmandoImportar, setConfirmandoImportar] = useState(false);

  const [salvandoEmailBoasVindas, setSalvandoEmailBoasVindas] = useState(false);
  const [erroEmailBoasVindas, setErroEmailBoasVindas] = useState("");
  const [sucessoEmailBoasVindas, setSucessoEmailBoasVindas] = useState(false);

  const [salvandoTemplatesMensagem, setSalvandoTemplatesMensagem] = useState(false);
  const [erroTemplatesMensagem, setErroTemplatesMensagem] = useState("");
  const [sucessoTemplatesMensagem, setSucessoTemplatesMensagem] = useState(false);

  const [enviandoLogo, setEnviandoLogo] = useState(false);
  const [erroLogo, setErroLogo] = useState("");
  const [enviandoFundo, setEnviandoFundo] = useState(false);
  const [erroFundo, setErroFundo] = useState("");
  const [opacidadeInput, setOpacidadeInput] = useState(100);
  const [fundoAjusteInput, setFundoAjusteInput] = useState(AJUSTE_FUNDO_PADRAO);
  const [nomeExibicaoInput, setNomeExibicaoInput] = useState("");
  const [salvandoIdentidade, setSalvandoIdentidade] = useState(false);
  const [erroIdentidade, setErroIdentidade] = useState("");
  const [sucessoIdentidade, setSucessoIdentidade] = useState(false);

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
  const [modalTipoAberto, setModalTipoAberto] = useState(false);
  const [editandoTipoId, setEditandoTipoId] = useState<string | null>(null);
  const [salvandoTipo, setSalvandoTipo] = useState(false);
  const [erroTipo, setErroTipo] = useState("");
  const [excluindoTipo, setExcluindoTipo] = useState<TipoSessaoItem | null>(null);
  const [erroExcluirTipo, setErroExcluirTipo] = useState("");
  const [removendoTipoId, setRemovendoTipoId] = useState<string | null>(null);

  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [carregandoGoogle, setCarregandoGoogle] = useState(true);
  const [erroCarregarGoogle, setErroCarregarGoogle] = useState(false);
  const [desconectandoGoogle, setDesconectandoGoogle] = useState(false);
  const [avisoGoogle, setAvisoGoogle] = useState<"conectado" | "erro" | null>(null);
  const [salvandoConfigSheets, setSalvandoConfigSheets] = useState(false);
  const [erroConfigSheets, setErroConfigSheets] = useState("");
  const [sucessoConfigSheets, setSucessoConfigSheets] = useState(false);
  const [editandoSheets, setEditandoSheets] = useState(false);
  const [confirmandoSheets, setConfirmandoSheets] = useState(false);
  const [sheetsPlanilhaIdInput, setSheetsPlanilhaIdInput] = useState("");
  const [sheetsAbaInput, setSheetsAbaInput] = useState("");
 

  function extractSheetIdFromUrl(urlOrId: string): string {
    const match = urlOrId.match(/\/d\/([^\/]+)/);
    if (match) {
      return match[1];
    }
    return urlOrId;
  }

  const [pastaRaizInput, setPastaRaizInput] = useState("");
  const [editandoPastaRaiz, setEditandoPastaRaiz] = useState(false);
  const [confirmandoPastaRaiz, setConfirmandoPastaRaiz] = useState(false);
  const [salvandoPastaRaiz, setSalvandoPastaRaiz] = useState(false);
  const [erroPastaRaiz, setErroPastaRaiz] = useState("");
  const [sucessoPastaRaiz, setSucessoPastaRaiz] = useState(false);

  async function carregarClinica() {
    setCarregandoClinica(true);
    setErroCarregarClinica(false);
    try {
      const res = await fetch("/api/clinica");
      if (res.ok) {
        const dados = await res.json();
        setClinica(dados);
        setPastaRaizInput(dados.pastaRaizDriveId ?? "");
        setOpacidadeInput(dados.fundoOpacidade ?? 100);
        setFundoAjusteInput(dados.fundoAjuste ?? AJUSTE_FUNDO_PADRAO);
        setNomeExibicaoInput(dados.nomeExibicao ?? "");
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

function handleChangeClinica(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
   const target = e.target;
   const { name } = target;
   let val: string | boolean;
   if (target.type === "checkbox") {
     val = (target as HTMLInputElement).checked;
   } else {
     val = target.value;
   }
   setClinica((c) => (c ? { ...c, [name]: val } : c));
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
          corPrimaria: clinica.corPrimaria,
          corSecundaria: clinica.corSecundaria,
          duracaoPadraoMin: clinica.duracaoPadraoMin,
          nomeAssistente: clinica.nomeAssistente,
          horarioLimiteConfirmacao: clinica.horarioLimiteConfirmacao,
          permitirResizeSessao: clinica.permitirResizeSessao,
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

  async function handleSalvarEmailBoasVindas(e: React.FormEvent) {
    e.preventDefault();
    if (!clinica) return;
    setErroEmailBoasVindas("");
    setSucessoEmailBoasVindas(false);
    setSalvandoEmailBoasVindas(true);

    try {
      const res = await fetch("/api/clinica", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailBoasVindasAssunto: clinica.emailBoasVindasAssunto,
          emailBoasVindasCorpo: clinica.emailBoasVindasCorpo,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErroEmailBoasVindas(data?.erro ?? "não foi possível salvar");
        return;
      }

      setClinica(await res.json());
      setSucessoEmailBoasVindas(true);
    } catch {
      setErroEmailBoasVindas("não foi possível salvar");
    } finally {
      setSalvandoEmailBoasVindas(false);
    }
  }
  
  async function handleSalvarTemplatesMensagem(e: React.FormEvent) {
    e.preventDefault();
    if (!clinica) return;
    setErroTemplatesMensagem("");
    setSucessoTemplatesMensagem(false);
    setSalvandoTemplatesMensagem(true);

    try {
      const res = await fetch("/api/clinica", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateConfirmacao: clinica.templateConfirmacao,
          templateMeet: clinica.templateMeet,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErroTemplatesMensagem(data?.erro ?? "não foi possível salvar");
        return;
      }

      setClinica(await res.json());
      setSucessoTemplatesMensagem(true);
    } catch {
      setErroTemplatesMensagem("não foi possível salvar");
    } finally {
      setSalvandoTemplatesMensagem(false);
    }
  }

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

      const atualizada = await res.json();
      setClinica(atualizada);
      setOpacidadeInput(atualizada.fundoOpacidade ?? 100);
      setFundoAjusteInput(atualizada.fundoAjuste ?? AJUSTE_FUNDO_PADRAO);
    } catch {
      setErro("não foi possível enviar a imagem");
    } finally {
      setEnviando(false);
    }
  }

  async function handleSalvarIdentidadeVisual() {
    setErroIdentidade("");
    setSucessoIdentidade(false);
    setSalvandoIdentidade(true);

    try {
      const res = await fetch("/api/clinica", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fundoOpacidade: opacidadeInput,
          fundoAjuste: fundoAjusteInput,
          nomeExibicao: nomeExibicaoInput || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErroIdentidade(data?.erro ?? "não foi possível salvar");
        return;
      }

      setClinica(await res.json());
      setSucessoIdentidade(true);
    } catch {
      setErroIdentidade("não foi possível salvar");
    } finally {
      setSalvandoIdentidade(false);
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
      setClinica(atualizada);
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
      setClinica(atualizada);
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

  function abrirConfirmacaoImportar() {
    setImportarErro("");
    setImportarSucesso(null);
    setConfirmandoImportar(true);
  }

  function cancelarImportar() {
    setConfirmandoImportar(false);
  }

  async function handleImportarPacientes() {
    setImportandoPacientes(true);
    setImportarErro("");
    setImportarSucesso(null);
    try {
      const res = await fetch("/api/importacao/executar", {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setImportarErro(data?.erro ?? "não foi possível executar a importação");
        return;
      }
      const resultado = await res.json();
      setImportarSucesso(resultado);
    } catch {
      setImportarErro("não foi possível executar a importação");
    } finally {
      setImportandoPacientes(false);
      setConfirmandoImportar(false);
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
              <CampoCor label="Cor primária" name="corPrimaria" value={clinica.corPrimaria ?? "#c9a96e"} onChange={handleChangeClinica} />
              <CampoCor label="Cor secundária" name="corSecundaria" value={clinica.corSecundaria ?? "#1a1a1a"} onChange={handleChangeClinica} />
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">
                  Permitir redimensionar a duração da sessão arrastando a borda no calendário
                </label>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="permitirResizeSessao"
                    checked={clinica?.permitirResizeSessao ?? false}
                    onChange={handleChangeClinica}
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

        {/* Identidade visual */}
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="mb-1 font-serif text-lg font-semibold text-fg">
            Identidade visual
          </h2>
          <p className="mb-4 text-sm text-muted">
            Logo e fundo de tela exibidos no painel da clínica.
          </p>

          {carregandoClinica ? (
            <p className="text-sm text-muted">Carregando...</p>
          ) : erroCarregarClinica || !clinica ? (
            <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
              Não foi possível carregar os dados da clínica.
            </p>
          ) : (
            <div className="space-y-6">
              {/* Texto ao lado da logo */}
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">
                  Texto ao lado da logo
                </label>
                <input
                  type="text"
                  value={nomeExibicaoInput}
                  onChange={(e) => {
                    setNomeExibicaoInput(e.target.value);
                    setSucessoIdentidade(false);
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
                {erroLogo && (
                  <p className="mt-2 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroLogo}</p>
                )}
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
                {erroFundo && (
                  <p className="mt-2 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroFundo}</p>
                )}

                <div className="mt-4">
                  <label className="mb-1 block text-sm font-medium text-fg">Ajuste da imagem</label>
                  <select
                    value={fundoAjusteInput}
                    onChange={(e) => {
                      setFundoAjusteInput(e.target.value);
                      setSucessoIdentidade(false);
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
                      setSucessoIdentidade(false);
                    }}
                    className="w-full accent-gold"
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={handleSalvarIdentidadeVisual}
                      disabled={salvandoIdentidade}
                      className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {salvandoIdentidade ? "Salvando..." : "Salvar identidade visual"}
                    </button>
                  </div>
                  {erroIdentidade && (
                    <p className="mt-2 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroIdentidade}</p>
                  )}
                  {sucessoIdentidade && (
                    <p className="mt-2 rounded-lg bg-green/10 px-3 py-2 text-sm text-green">
                      Identidade visual salva.
                    </p>
                  )}
                </div>
              </div>
            </div>
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

          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-fg">Pasta-mãe do Drive</label>

            {!editandoPastaRaiz ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2">
                {clinica?.pastaRaizDriveId ? (
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
              <p className="mt-2 rounded-lg bg-green/10 px-3 py-2 text-sm text-green">
                Pasta-mãe salva.
              </p>
            )}
          </div>
        </section>

        {/* Importação de formulário (Google Sheets) */}
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="mb-1 font-serif text-lg font-semibold text-fg">
            Importação de formulário (Google Sheets)
          </h2>
          <p className="mb-4 text-sm text-muted">
            Configure a planilha do Google Sheets de onde os dados dos pacientes serão importados.
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

                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2">
                    <button
                      type="button"
                      onClick={abrirConfirmacaoImportar}
                      className="shrink-0 rounded-lg border border-border px-3 py-1 text-sm font-medium text-fg hover:bg-bg"
                      disabled={importandoPacientes || !clinica?.sheetsPlanilhaId}
                    >
                      {importandoPacientes ? "Buscando..." : "Buscar novos pacientes"}
                    </button>
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
                        const value = e.target.value;
                        const id = extractSheetIdFromUrl(value);
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
                      Deixe em branco para usar a primeira aba (padrão: "Página1").
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
                <p className="mt-2 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
                  {erroConfigSheets}
                </p>
              )}
              {sucessoConfigSheets && (
                <p className="mt-2 rounded-lg bg-green/10 px-3 py-2 text-sm text-green">
                  Configurações salvas.
                </p>
              )}
            </>
          )}
        </section>

        {/* Email de boas-vindas */}
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="mb-1 font-serif text-lg font-semibold text-fg">
            Email de boas-vindas
          </h2>
          <p className="mb-4 text-sm text-muted">
            Template usado ao compartilhar a pasta de um paciente. <strong>{"{nome}"}</strong>{" "}
            é substituído pelo primeiro nome do paciente, e <strong>{"{link_pasta}"}</strong>{" "}
            vira o botão com o link da pasta do Drive.
          </p>

          {carregandoClinica ? (
            <p className="text-sm text-muted">Carregando...</p>
          ) : erroCarregarClinica || !clinica ? (
            <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
              Não foi possível carregar os dados da clínica.
            </p>
          ) : (
            <form onSubmit={handleSalvarEmailBoasVindas} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Assunto</label>
                <input
                  type="text"
                  name="emailBoasVindasAssunto"
                  value={clinica.emailBoasVindasAssunto}
                  onChange={handleChangeClinica}
                  required
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Corpo</label>
                <textarea
                  name="emailBoasVindasCorpo"
                  value={clinica.emailBoasVindasCorpo}
                  onChange={handleChangeClinica}
                  required
                  rows={10}
                  className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>

              {erroEmailBoasVindas && (
                <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
                  {erroEmailBoasVindas}
                </p>
              )}
              {sucessoEmailBoasVindas && (
                <p className="rounded-lg bg-green/10 px-3 py-2 text-sm text-green">
                  Template salvo.
                </p>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={salvandoEmailBoasVindas}
                  className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvandoEmailBoasVindas ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          )}
        </section>

        {/* Mensagens de copiar-colar (confirmação e link do Meet) */}
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="mb-1 font-serif text-lg font-semibold text-fg">
            Mensagens de copiar-colar
          </h2>
          <p className="mb-4 text-sm text-muted">
            Textos usados nos botões &quot;Copiar confirmação&quot; e &quot;Copiar link do Meet&quot;, na agenda e
            no painel do paciente. Variáveis disponíveis:{" "}
            <strong>{"{saudacao}"}</strong> (Bom dia/Boa tarde/Boa noite, conforme o horário atual),{" "}
            <strong>{"{paciente}"}</strong> (primeiro nome), <strong>{"{data}"}</strong> (dd/mm),{" "}
            <strong>{"{hora}"}</strong> (HH:MM), <strong>{"{horarioLimite}"}</strong> (limite de confirmação da
            clínica), <strong>{"{linkMeet}"}</strong> (link da sessão) e <strong>{"{assistente}"}</strong> (nome
            do assistente).
          </p>

          {carregandoClinica ? (
            <p className="text-sm text-muted">Carregando...</p>
          ) : erroCarregarClinica || !clinica ? (
            <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
              Não foi possível carregar os dados da clínica.
            </p>
          ) : (
            <form onSubmit={handleSalvarTemplatesMensagem} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Texto de confirmação</label>
                <textarea
                  name="templateConfirmacao"
                  value={clinica.templateConfirmacao}
                  onChange={handleChangeClinica}
                  required
                  rows={10}
                  className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Texto do link do Meet</label>
                <textarea
                  name="templateMeet"
                  value={clinica.templateMeet}
                  onChange={handleChangeClinica}
                  required
                  rows={8}
                  className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>

              {erroTemplatesMensagem && (
                <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
                  {erroTemplatesMensagem}
                </p>
              )}
              {sucessoTemplatesMensagem && (
                <p className="rounded-lg bg-green/10 px-3 py-2 text-sm text-green">
                  Template salvo.
                </p>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={salvandoTemplatesMensagem}
                  className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvandoTemplatesMensagem ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
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

        {/* Tipos de atendimento */}
        <section className="rounded-xl border border-border bg-surface p-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-lg font-semibold text-fg">
                Tipos de atendimento
              </h2>
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
      </main>

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
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">
              Excluir {excluindoTipo.nome}
            </h2>
            <p className="mb-4 text-sm text-muted">
              Tem certeza que deseja excluir este tipo de atendimento? Essa ação não pode ser desfeita.
            </p>

            {erroExcluirTipo && (
              <p className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
                {erroExcluirTipo}
              </p>
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

      {/* Modal: confirmar alteração da pasta-mãe do Drive */}
      {confirmandoPastaRaiz && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">
              Alterar pasta-mãe do Drive
            </h2>
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
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">
              Alterar configuração da planilha
            </h2>
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

      {/* Modal: confirmar importação de pacientes */}
      {confirmandoImportar && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-semibold text-lg font-serif text-fg">
              Confirmar importação de pacientes
            </h2>
            <p className="mb-4 text-sm text-muted">
              Deseja realmente executar a importação de pacientes da planilha configurada?
              Esta ação não pode ser desfeita.
            </p>

            {importarSucesso && (
              <div className="mb-4 p-4 bg-green/10 rounded-lg border border-green">
                <p className="mb-2 text-sm font-medium text-fg">
                  Importação concluída com sucesso!
                </p>
                <p className="mb-1 text-sm">
                  <span className="font-mono">Novos:</span> {importarSucesso.importados}
                </p>
                <p className="mb-1 text-sm">
                  <span className="font-mono">Existentes:</span> {importarSucesso.ignorados}
                </p>
                <p className="mb-1 text-sm">
                  <span className="font-mono">Erros:</span> {importarSucesso.erros}
                </p>
              </div>
            )}

            {importarErro && (
              <p className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
                {importarErro}
              </p>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={cancelarImportar}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleImportarPacientes}
                disabled={importandoPacientes}
                className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importandoPacientes ? "Importando..." : "Confirmar importação"}
              </button>
            </div>
          </div>
        </div>
      )}
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
