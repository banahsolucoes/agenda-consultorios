import { describe, expect, it } from "vitest";
import { textoLinhaBlocoAgenda } from "./blocoAgenda";

describe("textoLinhaBlocoAgenda", () => {
  it("mostra apenas o primeiro nome e a numeração quando não confirmada", () => {
    expect(textoLinhaBlocoAgenda("William Silva", 12, 12, false)).toBe("William 12/12");
  });

  it("acrescenta ✅ ao final quando confirmada", () => {
    expect(textoLinhaBlocoAgenda("William Silva", 12, 12, true)).toBe("William 12/12 ✅");
  });

  it("funciona com paciente de nome único", () => {
    expect(textoLinhaBlocoAgenda("Madonna", 1, 4, true)).toBe("Madonna 1/4 ✅");
  });

  it("não confunde confirmação com o status da sessão — é só um texto extra", () => {
    // a numeração e o nome não mudam de formato dependendo de status; a
    // função nem recebe status, só o booleano de confirmação
    const semConfirmar = textoLinhaBlocoAgenda("Ana Souza", 3, 8, false);
    const confirmada = textoLinhaBlocoAgenda("Ana Souza", 3, 8, true);
    expect(confirmada).toBe(`${semConfirmar} ✅`);
  });
});
