"use client";

import { useMemo, useState } from "react";
import { componentesSP } from "@/lib/timezone";
import { parseISO, formatarExibicao, construirCelulas } from "./dateGrid";

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const DIAS_SEMANA_CURTO = ["D", "S", "T", "Q", "Q", "S", "S"];

// Seletor de calendário (clicar para escolher, sem digitar), sempre no
// calendário de São Paulo — a "hoje" destacada e a navegação de mês usam
// componentesSP em vez do fuso local do navegador.
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

  const celulas = useMemo(() => construirCelulas(mesExibido.ano, mesExibido.mes), [mesExibido]);
  const selecionado = parseISO(value);

  function abrir() {
    const c = parseISO(value);
    setMesExibido(c ? { ano: c.ano, mes: c.mes } : { ano: hojeSP.ano, mes: hojeSP.mes });
    setAberto(true);
  }

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
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setAberto(false);
      }}
    >
      <button
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

      {aberto && (
        <div className="absolute z-10 mt-1 w-64 rounded-lg border border-border bg-surface p-3 shadow-lg">
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
        </div>
      )}
    </div>
  );
}
