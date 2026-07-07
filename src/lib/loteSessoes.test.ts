import { describe, expect, it } from "vitest";
import {
  filtrarSessoesElegiveis,
  montarDetalheLote,
  resolverNomePaciente,
  statusLoteValido,
} from "./loteSessoes";

const CLINICA_A = "clinica-a";
const CLINICA_B = "clinica-b";

function sessao(id: string, status: string, clinicaId: string = CLINICA_A) {
  return { id, status, paciente: { clinicaId } };
}

describe("statusLoteValido", () => {
  it("aceita REALIZADA, NAO_REALIZADA e CANCELADA", () => {
    expect(statusLoteValido("REALIZADA")).toBe(true);
    expect(statusLoteValido("NAO_REALIZADA")).toBe(true);
    expect(statusLoteValido("CANCELADA")).toBe(true);
  });

  it("rejeita status fora da lista, inclusive os que a sessão individual aceita", () => {
    expect(statusLoteValido("AGENDADA")).toBe(false);
    expect(statusLoteValido("REAGENDADA")).toBe(false);
    expect(statusLoteValido("QUALQUER_COISA")).toBe(false);
  });

  it("rejeita valores que não são string", () => {
    expect(statusLoteValido(undefined)).toBe(false);
    expect(statusLoteValido(null)).toBe(false);
    expect(statusLoteValido(42)).toBe(false);
  });
});

describe("filtrarSessoesElegiveis", () => {
  it("mantém apenas sessões agendadas/reagendadas da clínica do usuário", () => {
    const sessoes = [
      sessao("1", "AGENDADA"),
      sessao("2", "REAGENDADA"),
      sessao("3", "REALIZADA"),
      sessao("4", "NAO_REALIZADA"),
      sessao("5", "CANCELADA"),
    ];

    const elegiveis = filtrarSessoesElegiveis(sessoes, CLINICA_A);

    expect(elegiveis.map((s) => s.id)).toEqual(["1", "2"]);
  });

  it("nunca deixa passar sessão de outra clínica (multi-tenant), mesmo com status elegível", () => {
    const sessoes = [sessao("1", "AGENDADA", CLINICA_A), sessao("2", "AGENDADA", CLINICA_B)];

    const elegiveis = filtrarSessoesElegiveis(sessoes, CLINICA_A);

    expect(elegiveis.map((s) => s.id)).toEqual(["1"]);
  });

  it("retorna lista vazia quando nenhuma sessão é elegível, sem lançar erro", () => {
    const sessoes = [sessao("1", "CANCELADA"), sessao("2", "REALIZADA", CLINICA_B)];

    expect(filtrarSessoesElegiveis(sessoes, CLINICA_A)).toEqual([]);
  });
});

describe("resolverNomePaciente", () => {
  it("retorna o nome quando todas as sessões são do mesmo paciente", () => {
    expect(resolverNomePaciente(["Maria", "Maria", "Maria"])).toBe("Maria");
  });

  it("agrega em contagem quando há mais de um paciente", () => {
    expect(resolverNomePaciente(["Maria", "João"])).toBe("2 pacientes");
  });
});

describe("montarDetalheLote", () => {
  it("descreve cancelamento em lote com o motivo", () => {
    expect(montarDetalheLote("CANCELADA", 7, "Maria", "paciente migrou de convênio")).toBe(
      "Cancelou 7 sessões de Maria — motivo: paciente migrou de convênio"
    );
  });

  it("descreve mudança de status em lote com o rótulo amigável", () => {
    expect(montarDetalheLote("REALIZADA", 1, "Maria", "")).toBe("Marcou 1 sessão de Maria como Realizada");
    expect(montarDetalheLote("NAO_REALIZADA", 3, "João", "")).toBe(
      "Marcou 3 sessões de João como Não realizada"
    );
  });
});
