import { describe, expect, it } from "vitest";
import {
  calcularJanelaSemana,
  existeConflitoDeSemana,
  validarCadencia,
  validarCadenciaLote,
  type SessaoParaConflito,
} from "./conflitoSemana";

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

// Semana de referência: segunda 2026-07-06 a domingo 2026-07-12 (SP).
describe("validarCadencia — limite 1 (comportamento histórico)", () => {
  it("bloqueia com SEMANA_CHEIA quando já há outra sessão na semana", () => {
    const r = validarCadencia({
      novaData: sp("2026-07-09T15:00:00"),
      outrasSessoes: [sessao("2", "2026-07-06T10:00:00", "AGENDADA")],
      limite: 1,
    });
    expect(r).toMatchObject({ ok: false, motivo: "SEMANA_CHEIA" });
  });

  it("ignora sessões canceladas e de outras semanas", () => {
    const r = validarCadencia({
      novaData: sp("2026-07-09T15:00:00"),
      outrasSessoes: [
        sessao("2", "2026-07-06T10:00:00", "CANCELADA"),
        sessao("3", "2026-06-29T10:00:00", "AGENDADA"),
      ],
      limite: 1,
    });
    expect(r.ok).toBe(true);
  });

  it("mesmo dia com limite 1 é SEMANA_CHEIA (não MESMO_DIA)", () => {
    const r = validarCadencia({
      novaData: sp("2026-07-07T15:00:00"),
      outrasSessoes: [sessao("2", "2026-07-07T09:00:00", "AGENDADA")],
      limite: 1,
    });
    expect(r).toMatchObject({ ok: false, motivo: "SEMANA_CHEIA" });
  });
});

describe("validarCadencia — limite 2", () => {
  it("permite a 2ª sessão com intervalo suficiente (terça + quinta)", () => {
    const r = validarCadencia({
      novaData: sp("2026-07-09T15:00:00"), // quinta
      outrasSessoes: [sessao("2", "2026-07-07T10:00:00", "AGENDADA")], // terça
      limite: 2,
    });
    expect(r.ok).toBe(true);
  });

  it("bloqueia a 3ª sessão na semana com SEMANA_CHEIA", () => {
    const r = validarCadencia({
      novaData: sp("2026-07-11T10:00:00"), // sábado
      outrasSessoes: [
        sessao("2", "2026-07-07T10:00:00", "AGENDADA"), // terça
        sessao("3", "2026-07-09T10:00:00", "AGENDADA"), // quinta
      ],
      limite: 2,
    });
    expect(r).toMatchObject({ ok: false, motivo: "SEMANA_CHEIA" });
  });

  it("bloqueia duas sessões no mesmo dia com MESMO_DIA", () => {
    const r = validarCadencia({
      novaData: sp("2026-07-07T16:00:00"),
      outrasSessoes: [sessao("2", "2026-07-07T09:00:00", "AGENDADA")],
      limite: 2,
    });
    expect(r).toMatchObject({ ok: false, motivo: "MESMO_DIA" });
  });

  it("bloqueia dias consecutivos (segunda + terça) com INTERVALO_MINIMO", () => {
    const r = validarCadencia({
      novaData: sp("2026-07-07T08:00:00"), // terça
      outrasSessoes: [sessao("2", "2026-07-06T19:00:00", "AGENDADA")], // segunda
      limite: 2,
    });
    expect(r).toMatchObject({ ok: false, motivo: "INTERVALO_MINIMO" });
  });

  it("não valida intervalo entre semanas diferentes (domingo + segunda seguinte)", () => {
    const r = validarCadencia({
      novaData: sp("2026-07-13T08:00:00"), // segunda seguinte
      outrasSessoes: [sessao("2", "2026-07-12T18:00:00", "AGENDADA")], // domingo
      limite: 2,
    });
    expect(r.ok).toBe(true);
  });

  it("cancelada não conta para o limite nem para o intervalo", () => {
    const r = validarCadencia({
      novaData: sp("2026-07-07T16:00:00"),
      outrasSessoes: [
        sessao("2", "2026-07-07T09:00:00", "CANCELADA"),
        sessao("3", "2026-07-09T09:00:00", "AGENDADA"),
      ],
      limite: 2,
    });
    expect(r.ok).toBe(true);
  });
});

describe("validarCadenciaLote", () => {
  it("detecta colisão entre as próprias sessões movidas", () => {
    const conflitos = validarCadenciaLote(
      [
        { id: "a", novaData: sp("2026-07-07T10:00:00"), limite: 1 },
        { id: "b", novaData: sp("2026-07-09T10:00:00"), limite: 1 },
      ],
      []
    );
    expect(conflitos.map((c) => c.id)).toEqual(["b"]);
  });

  it("aceita padrão 2x (terça/quinta) em semanas seguidas", () => {
    const conflitos = validarCadenciaLote(
      [
        { id: "a", novaData: sp("2026-07-07T10:00:00"), limite: 2 },
        { id: "b", novaData: sp("2026-07-09T10:00:00"), limite: 2 },
        { id: "c", novaData: sp("2026-07-14T10:00:00"), limite: 2 },
        { id: "d", novaData: sp("2026-07-16T10:00:00"), limite: 2 },
      ],
      []
    );
    expect(conflitos).toEqual([]);
  });

  it("ignora em `fixas` as sessões que estão no próprio conjunto (posição antiga)", () => {
    const conflitos = validarCadenciaLote(
      [{ id: "a", novaData: sp("2026-07-14T10:00:00"), limite: 1 }],
      [sessao("a", "2026-07-15T10:00:00", "AGENDADA")]
    );
    expect(conflitos).toEqual([]);
  });

  it("valida contra as fixas e lista todas as datas em conflito", () => {
    const conflitos = validarCadenciaLote(
      [
        { id: "a", novaData: sp("2026-07-07T10:00:00"), limite: 1 },
        { id: "b", novaData: sp("2026-07-14T10:00:00"), limite: 1 },
      ],
      [sessao("x", "2026-07-08T10:00:00", "AGENDADA"), sessao("y", "2026-07-15T10:00:00", "AGENDADA")]
    );
    expect(conflitos.map((c) => c.id)).toEqual(["a", "b"]);
  });
});
