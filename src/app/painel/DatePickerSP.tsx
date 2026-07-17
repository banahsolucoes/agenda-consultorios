"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { componentesSP } from "@/lib/timezone";
import { parseISO, formatarExibicao, construirCelulas } from "./dateGrid";

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const DIAS_SEMANA_CURTO = ["D", "S", "T", "Q", "Q", "S", "S"];

// Largura do popup (w-64 = 16rem) e altura estimada antes da primeira
// medição real — usada só pra escolher acima/abaixo sem flicker no primeiro
// frame; a medição real (useLayoutEffect) corrige antes do paint.
const LARGURA_POPUP = 256;
const ALTURA_ESTIMADA = 340;
const GAP = 4;
const MARGEM_VIEWPORT = 8;

// Seletor de calendário (clicar para escolher, sem digitar), sempre no
// calendário de São Paulo — a "hoje" destacada e a navegação de mês usam
// componentesSP em vez do fuso local do navegador.
//
// O popup é renderizado num portal (document.body) com position:fixed,
// posicionado dinamicamente acima ou abaixo do campo conforme o espaço
// disponível na viewport — nunca é cortado por overflow/scroll de um
// container ancestral (ex.: a tabela do grid de parcelas do módulo Mentoria).
export default function DatePickerSP({
  value,
  onChange,
  placeholder = "Selecionar data",
}: {
  value: string; // "YYYY-MM-DD" ou ""
  onChange: (valor: string) => void;
  placeholder?: string;
}) {
  const hojeSP = useMemo(() => componentesSP(new Date()), []);
  const [aberto, setAberto] = useState(false);
  const [mesExibido, setMesExibido] = useState(() => {
    const c = parseISO(value);
    return c ? { ano: c.ano, mes: c.mes } : { ano: hojeSP.ano, mes: hojeSP.mes };
  });
  const [posicao, setPosicao] = useState<{ top: number; left: number } | null>(null);

  const botaoRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const celulas = useMemo(() => construirCelulas(mesExibido.ano, mesExibido.mes), [mesExibido]);
  const selecionado = parseISO(value);

  function calcularPosicao(alturaPopup: number) {
    const botao = botaoRef.current;
    if (!botao) return;
    const rect = botao.getBoundingClientRect();
    const espacoAbaixo = window.innerHeight - rect.bottom;
    const espacoAcima = rect.top;
    const abrePraCima = espacoAbaixo < alturaPopup + GAP && espacoAcima > espacoAbaixo;

    const top = abrePraCima ? rect.top - alturaPopup - GAP : rect.bottom + GAP;
    const topClampado = Math.max(MARGEM_VIEWPORT, Math.min(top, window.innerHeight - alturaPopup - MARGEM_VIEWPORT));
    const left = Math.max(MARGEM_VIEWPORT, Math.min(rect.left, window.innerWidth - LARGURA_POPUP - MARGEM_VIEWPORT));

    setPosicao({ top: topClampado, left });
  }

  function abrir() {
    const c = parseISO(value);
    setMesExibido(c ? { ano: c.ano, mes: c.mes } : { ano: hojeSP.ano, mes: hojeSP.mes });
    calcularPosicao(ALTURA_ESTIMADA);
    setAberto(true);
  }

  // Corrige a posição com a altura REAL do popup assim que ele existe no DOM
  // (roda antes do paint, sem flicker) — e de novo se a página rolar/mudar
  // de tamanho enquanto o calendário está aberto.
  useLayoutEffect(() => {
    if (!aberto) return;
    if (popupRef.current) calcularPosicao(popupRef.current.offsetHeight);

    function reposicionar() {
      if (popupRef.current) calcularPosicao(popupRef.current.offsetHeight);
    }
    window.addEventListener("scroll", reposicionar, true);
    window.addEventListener("resize", reposicionar);
    return () => {
      window.removeEventListener("scroll", reposicionar, true);
      window.removeEventListener("resize", reposicionar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, mesExibido]);

  // Fecha ao clicar fora — botão e popup agora vivem em subárvores DOM
  // diferentes (popup no portal), então onBlur do wrapper não alcança mais.
  useEffect(() => {
    if (!aberto) return;
    function handleClickFora(e: MouseEvent) {
      const alvo = e.target as Node;
      if (botaoRef.current?.contains(alvo)) return;
      if (popupRef.current?.contains(alvo)) return;
      setAberto(false);
    }
    document.addEventListener("mousedown", handleClickFora);
    return () => document.removeEventListener("mousedown", handleClickFora);
  }, [aberto]);

  function mesAnterior() {
    setMesExibido(({ ano, mes }) => (mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 }));
  }
  function mesProximo() {
    setMesExibido(({ ano, mes }) => (mes === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: mes + 1 }));
  }

  function selecionar(dia: number) {
    const iso = `${mesExibido.ano}-${String(mesExibido.mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    onChange(iso);
    setAberto(false);
  }

  return (
    <div className="relative">
      <button
        ref={botaoRef}
        type="button"
        onClick={() => (aberto ? setAberto(false) : abrir())}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-left text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
      >
        <span className={value ? "text-fg" : "text-muted"}>
          {value ? formatarExibicao(value) : placeholder}
        </span>
      </button>

      {aberto &&
        posicao &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popupRef}
            style={{ position: "fixed", top: posicao.top, left: posicao.left }}
            className="z-[100] w-64 rounded-lg border border-border bg-surface p-3 shadow-lg"
          >
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={mesAnterior}
                aria-label="Mês anterior"
                className="rounded-md p-1 text-muted hover:bg-bg hover:text-fg"
              >
                ‹
              </button>
              <span className="text-sm font-medium text-fg">
                {MESES[mesExibido.mes - 1]} {mesExibido.ano}
              </span>
              <button
                type="button"
                onClick={mesProximo}
                aria-label="Próximo mês"
                className="rounded-md p-1 text-muted hover:bg-bg hover:text-fg"
              >
                ›
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted">
              {DIAS_SEMANA_CURTO.map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {celulas.map((dia, i) => {
                if (dia === null) return <span key={i} />;
                const ehHoje = mesExibido.ano === hojeSP.ano && mesExibido.mes === hojeSP.mes && dia === hojeSP.dia;
                const ehSelecionado =
                  selecionado !== null &&
                  mesExibido.ano === selecionado.ano &&
                  mesExibido.mes === selecionado.mes &&
                  dia === selecionado.dia;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => selecionar(dia)}
                    className={`rounded-md py-1.5 text-sm ${
                      ehSelecionado
                        ? "bg-gold font-semibold text-bg"
                        : ehHoje
                          ? "border border-gold text-gold"
                          : "text-fg hover:bg-bg"
                    }`}
                  >
                    {dia}
                  </button>
                );
              })}
            </div>

            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setAberto(false);
                }}
                className="mt-2 w-full rounded-lg border border-border px-2 py-1 text-xs text-muted hover:bg-bg hover:text-fg"
              >
                Limpar data
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
