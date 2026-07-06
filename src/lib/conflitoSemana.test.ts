import { describe, expect, it } from "vitest";
import { calcularJanelaSemana, existeConflitoDeSemana, type SessaoParaConflito } from "./conflitoSemana";

// Datas em ISO com o offset explícito de São Paulo (-03:00), para não
// depender do fuso horário de quem roda o teste.
function sp(iso: string) {
  return new Date(`${iso}-03:00`);
}

function sessao(id: string, iso: string, status: string): SessaoParaConflito {
  return { id, inicio: sp(iso), status };
}

describe("calcularJanelaSemana", () => {
  it("calcula segunda 00:00 até a próxima segunda 00:00 (exclusive) em SP", () => {
    // quarta-feira, 2026-07-08
    const { inicio, fim } = calcularJanelaSemana(sp("2026-07-08T14:00:00"));
    expect(inicio.toISOString()).toBe(sp("2026-07-06T00:00:00").toISOString());
    expect(fim.toISOString()).toBe(sp("2026-07-13T00:00:00").toISOString());
  });

  it("uma sessão de domingo pertence à semana que começou na segunda anterior", () => {
    // domingo, 2026-07-12
    const { inicio, fim } = calcularJanelaSemana(sp("2026-07-12T09:00:00"));
    expect(inicio.toISOString()).toBe(sp("2026-07-06T00:00:00").toISOString());
    expect(fim.toISOString()).toBe(sp("2026-07-13T00:00:00").toISOString());
  });
});

describe("existeConflitoDeSemana", () => {
  it("bloqueia quando já existe outra sessão não cancelada na mesma semana", () => {
    const outras = [sessao("2", "2026-07-06T10:00:00", "AGENDADA")]; // segunda da mesma semana
    const novaData = sp("2026-07-09T15:00:00"); // quinta da mesma semana
    expect(existeConflitoDeSemana(novaData, outras)).toBe(true);
  });

  it("permite quando a outra sessão na mesma semana está CANCELADA", () => {
    const outras = [sessao("2", "2026-07-06T10:00:00", "CANCELADA")];
    const novaData = sp("2026-07-09T15:00:00");
    expect(existeConflitoDeSemana(novaData, outras)).toBe(false);
  });

  it("permite quando a outra sessão do paciente está em outra semana", () => {
    const outras = [sessao("2", "2026-06-29T10:00:00", "AGENDADA")]; // semana anterior
    const novaData = sp("2026-07-09T15:00:00");
    expect(existeConflitoDeSemana(novaData, outras)).toBe(false);
  });

  it("permite quando não há nenhuma outra sessão do paciente", () => {
    expect(existeConflitoDeSemana(sp("2026-07-09T15:00:00"), [])).toBe(false);
  });

  it("detecta conflito no limite exato da semana (domingo 23:59 vs. segunda seguinte)", () => {
    const outras = [sessao("2", "2026-07-12T23:59:00", "AGENDADA")]; // domingo, ainda na semana
    const novaData = sp("2026-07-06T08:00:00"); // segunda da mesma semana
    expect(existeConflitoDeSemana(novaData, outras)).toBe(true);

    const novaDataSemanaSeguinte = sp("2026-07-13T08:00:00"); // segunda seguinte — fora
    expect(existeConflitoDeSemana(novaDataSemanaSeguinte, outras)).toBe(false);
  });
});
