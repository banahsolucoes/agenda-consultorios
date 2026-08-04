"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type PerguntaPublica,
  montarEtapas,
  validarValorPorTipo,
} from "@/lib/formularioPublico";
import { formatarCpf } from "@/lib/cpf";

interface Props {
  clinicaSlug: string;
  clinicaNome: string;
  formularioSlug: string;
  formularioTitulo: string;
  formularioDescricao: string | null;
  textoConsentimento: string;
  perguntas: PerguntaPublica[];
}

interface Rascunho {
  respostas: Record<string, string>;
  etapaIndex: number;
  consentimentoAceito: boolean;
}

function chaveRascunho(clinicaSlug: string, formularioSlug: string): string {
  return `anamnese-rascunho-${clinicaSlug}-${formularioSlug}`;
}

function formatarTelefone(digitos: string): string {
  const d = digitos.slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function formatarCep(digitos: string): string {
  const d = digitos.slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

function mascararPorTipo(tipo: string, valorAtual: string, entrada: string): string {
  if (tipo === "CPF") return formatarCpf(entrada.replace(/\D/g, ""));
  if (tipo === "TELEFONE") return formatarTelefone(entrada.replace(/\D/g, ""));
  if (tipo === "CEP") return formatarCep(entrada.replace(/\D/g, ""));
  return entrada;
}

export default function FormularioWizard({
  clinicaSlug,
  clinicaNome,
  formularioSlug,
  formularioTitulo,
  formularioDescricao,
  textoConsentimento,
  perguntas,
}: Props) {
  const etapasConteudo = useMemo(() => montarEtapas(perguntas), [perguntas]);
  const totalEtapas = etapasConteudo.length + 1; // + consentimento
  const etapaConsentimentoIndex = etapasConteudo.length;

  const [etapaIndex, setEtapaIndex] = useState(0);
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const [erros, setErros] = useState<Record<string, string>>({});
  const [consentimentoAceito, setConsentimentoAceito] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [rascunhoDisponivel, setRascunhoDisponivel] = useState<Rascunho | null>(null);
  const [rascunhoResolvido, setRascunhoResolvido] = useState(false);
  const [verificandoRascunho, setVerificandoRascunho] = useState(true);

  // Ao abrir, checa se há rascunho salvo neste dispositivo para este
  // formulário — oferece retomar em vez de carregar direto (evita apagar
  // silenciosamente o que a pessoa já tinha preenchido).
  useEffect(() => {
    try {
      const bruto = localStorage.getItem(chaveRascunho(clinicaSlug, formularioSlug));
      if (bruto) {
        const dados = JSON.parse(bruto) as Rascunho;
        if (dados && typeof dados === "object" && dados.respostas) {
          setRascunhoDisponivel(dados);
          setVerificandoRascunho(false);
          return;
        }
      }
    } catch {
      // rascunho corrompido/indisponível — ignora, segue vazio
    }
    setRascunhoResolvido(true);
    setVerificandoRascunho(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persiste o progresso a cada mudança, uma vez resolvida a decisão sobre
  // o rascunho anterior (evita sobrescrever o rascunho antigo antes da
  // pessoa decidir retomar ou começar do zero).
  useEffect(() => {
    if (!rascunhoResolvido || enviado) return;
    const dados: Rascunho = { respostas, etapaIndex, consentimentoAceito };
    try {
      localStorage.setItem(chaveRascunho(clinicaSlug, formularioSlug), JSON.stringify(dados));
    } catch {
      // localStorage indisponível (modo privado, quota) — segue sem rascunho
    }
  }, [respostas, etapaIndex, consentimentoAceito, rascunhoResolvido, enviado, clinicaSlug, formularioSlug]);

  function retomarRascunho() {
    if (!rascunhoDisponivel) return;
    setRespostas(rascunhoDisponivel.respostas);
    setEtapaIndex(rascunhoDisponivel.etapaIndex);
    setConsentimentoAceito(rascunhoDisponivel.consentimentoAceito);
    setRascunhoDisponivel(null);
    setRascunhoResolvido(true);
  }

  function comecarDoZero() {
    try {
      localStorage.removeItem(chaveRascunho(clinicaSlug, formularioSlug));
    } catch {
      // ignora
    }
    setRascunhoDisponivel(null);
    setRascunhoResolvido(true);
  }

  function atualizarResposta(perguntaId: string, valor: string) {
    setRespostas((prev) => ({ ...prev, [perguntaId]: valor }));
    setErros((prev) => {
      if (!prev[perguntaId]) return prev;
      const proximo = { ...prev };
      delete proximo[perguntaId];
      return proximo;
    });
  }

  function validarEtapaAtual(): boolean {
    const etapa = etapasConteudo[etapaIndex];
    if (!etapa) return true;
    const novosErros: Record<string, string> = {};

    for (const pergunta of etapa.perguntas) {
      const valor = (respostas[pergunta.id] || "").trim();
      if (pergunta.obrigatoria && !valor) {
        novosErros[pergunta.id] = "Campo obrigatório";
        continue;
      }
      const erroTipo = validarValorPorTipo(pergunta.tipo, valor);
      if (erroTipo) novosErros[pergunta.id] = erroTipo;
    }

    setErros(novosErros);
    return Object.keys(novosErros).length === 0;
  }

  function avancar() {
    if (!validarEtapaAtual()) return;
    setEtapaIndex((i) => Math.min(i + 1, totalEtapas - 1));
  }

  function voltar() {
    setEtapaIndex((i) => Math.max(i - 1, 0));
  }

  async function enviar() {
    if (!consentimentoAceito) return;
    setEnviando(true);
    setErroEnvio(null);

    try {
      const res = await fetch(`/api/f/${clinicaSlug}/${formularioSlug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          respostas: perguntas
            .map((p) => ({ perguntaId: p.id, valor: (respostas[p.id] || "").trim() }))
            .filter((r) => r.valor.length > 0),
          consentimentoAceito,
          // honeypot: campo que só um bot preencheria (invisível pra humano)
          website: honeypot,
        }),
      });

      if (!res.ok) {
        setErroEnvio("Não foi possível enviar agora. Tente novamente em instantes.");
        return;
      }

      try {
        localStorage.removeItem(chaveRascunho(clinicaSlug, formularioSlug));
      } catch {
        // ignora
      }
      setEnviado(true);
    } catch {
      setErroEnvio("Não foi possível enviar agora. Verifique sua conexão e tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green/10 text-2xl text-green">
            ✓
          </div>
          <h1 className="font-serif text-xl font-semibold text-fg">Recebemos suas respostas</h1>
          <p className="mt-2 text-sm text-muted">
            Obrigado por preencher a anamnese para {clinicaNome}. A equipe vai revisar suas
            respostas antes da sua sessão.
          </p>
        </div>
      </div>
    );
  }

  if (verificandoRascunho) {
    return <div className="min-h-screen bg-bg" />;
  }

  if (!rascunhoResolvido && rascunhoDisponivel) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 text-center shadow-sm">
          <h1 className="font-serif text-lg font-semibold text-fg">Continuar de onde parou?</h1>
          <p className="mt-2 text-sm text-muted">
            Encontramos respostas salvas neste dispositivo para este formulário.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <button
              onClick={retomarRascunho}
              className="w-full rounded-lg bg-gold px-4 py-2 font-medium text-bg transition-colors hover:brightness-110"
            >
              Retomar de onde parei
            </button>
            <button
              onClick={comecarDoZero}
              className="w-full rounded-lg border border-border px-4 py-2 font-medium text-fg transition-colors hover:bg-bg"
            >
              Começar do zero
            </button>
          </div>
        </div>
      </div>
    );
  }

  const naConsentimento = etapaIndex === etapaConsentimentoIndex;
  const etapaAtual = etapasConteudo[etapaIndex];
  const nomeEtapaAtual = naConsentimento ? "Consentimento" : etapaAtual?.nome ?? "";

  return (
    <div className="min-h-screen bg-bg px-4 py-6">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="font-serif text-xl font-semibold text-fg">{formularioTitulo}</h1>
          {formularioDescricao && <p className="mt-1 text-sm text-muted">{formularioDescricao}</p>}
        </div>

        {/* Barra de progresso */}
        <div className="mb-1 flex items-center justify-between text-xs text-muted">
          <span>
            Etapa {etapaIndex + 1} de {totalEtapas} — {nomeEtapaAtual}
          </span>
        </div>
        <div className="mb-6 h-2 w-full overflow-hidden rounded-full bg-surface">
          <div
            className="h-full rounded-full bg-gold transition-all"
            style={{ width: `${((etapaIndex + 1) / totalEtapas) * 100}%` }}
          />
        </div>

        <p className="mb-4 text-xs text-muted">
          Suas respostas ficam salvas neste dispositivo até o envio.
        </p>

        {/* honeypot — invisível pra humano, campo isca pra bot */}
        <input
          type="text"
          name="website"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute -left-[9999px] h-0 w-0 opacity-0"
        />

        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          {naConsentimento ? (
            <div>
              <h2 className="mb-3 font-serif text-lg font-semibold text-fg">Consentimento</h2>
              <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-bg p-4 text-sm text-muted">
                {textoConsentimento}
              </div>
              <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={consentimentoAceito}
                  onChange={(e) => setConsentimentoAceito(e.target.checked)}
                  className="mt-0.5"
                />
                Li e aceito os termos acima.
              </label>
              {erroEnvio && (
                <p className="mt-3 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroEnvio}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {etapaAtual?.perguntas.map((pergunta) => (
                <CampoPergunta
                  key={pergunta.id}
                  pergunta={pergunta}
                  valor={respostas[pergunta.id] || ""}
                  erro={erros[pergunta.id]}
                  onChange={(v) => atualizarResposta(pergunta.id, v)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 flex gap-3">
          {etapaIndex > 0 && (
            <button
              onClick={voltar}
              className="flex-1 rounded-lg border border-border px-4 py-3 font-medium text-fg transition-colors hover:bg-surface"
            >
              Voltar
            </button>
          )}
          {naConsentimento ? (
            <button
              onClick={enviar}
              disabled={!consentimentoAceito || enviando}
              className="flex-1 rounded-lg bg-gold px-4 py-3 font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enviando ? "Enviando..." : "Enviar"}
            </button>
          ) : (
            <button
              onClick={avancar}
              className="flex-1 rounded-lg bg-gold px-4 py-3 font-medium text-bg transition-colors hover:brightness-110"
            >
              Continuar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CampoPergunta({
  pergunta,
  valor,
  erro,
  onChange,
}: {
  pergunta: PerguntaPublica;
  valor: string;
  erro?: string;
  onChange: (valor: string) => void;
}) {
  const rotulo = (
    <label className="mb-1.5 block text-sm font-medium text-fg">
      {pergunta.rotulo}
      {!pergunta.obrigatoria && <span className="ml-1.5 text-xs font-normal text-muted">(Opcional)</span>}
    </label>
  );

  return (
    <div>
      {rotulo}
      {pergunta.descricao && <p className="mb-1.5 text-xs text-muted">{pergunta.descricao}</p>}

      {pergunta.tipo === "SIM_NAO" ? (
        <div className="grid grid-cols-2 gap-3">
          {["Sim", "Não"].map((opcao) => (
            <button
              key={opcao}
              type="button"
              onClick={() => onChange(opcao)}
              className={`rounded-lg border px-4 py-3 text-center font-medium transition-colors ${
                valor === opcao
                  ? "border-gold bg-gold/10 text-gold"
                  : "border-border bg-bg text-fg hover:bg-surface"
              }`}
            >
              {opcao}
            </button>
          ))}
        </div>
      ) : pergunta.tipo === "MULTIPLA_ESCOLHA" ? (
        <div className="flex flex-col gap-2">
          {pergunta.opcoes.map((opcao) => (
            <button
              key={opcao}
              type="button"
              onClick={() => onChange(opcao)}
              className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                valor === opcao
                  ? "border-gold bg-gold/10 text-gold"
                  : "border-border bg-bg text-fg hover:bg-surface"
              }`}
            >
              {opcao}
            </button>
          ))}
        </div>
      ) : pergunta.tipo === "TEXTO_LONGO" ? (
        <textarea
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
        />
      ) : pergunta.tipo === "DATA" ? (
        <input
          type="date"
          value={valor}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
        />
      ) : pergunta.tipo === "EMAIL" ? (
        <input
          type="email"
          inputMode="email"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
        />
      ) : pergunta.tipo === "CPF" || pergunta.tipo === "TELEFONE" || pergunta.tipo === "CEP" ? (
        <input
          type="text"
          inputMode="numeric"
          value={valor}
          onChange={(e) => onChange(mascararPorTipo(pergunta.tipo, valor, e.target.value))}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
        />
      ) : (
        <input
          type="text"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
        />
      )}

      {erro && <p className="mt-1 text-xs text-red">{erro}</p>}
    </div>
  );
}
