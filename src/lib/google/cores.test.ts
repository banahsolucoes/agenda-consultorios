import { describe, expect, it } from "vitest";
import { mapearCorParaGoogleColorId } from "./cores";

describe("mapearCorParaGoogleColorId", () => {
  it("mapeia uma cor exata da paleta do Google para o colorId correspondente", () => {
    expect(mapearCorParaGoogleColorId("#dc2127")).toBe("11"); // Tomato
    expect(mapearCorParaGoogleColorId("#51b749")).toBe("10"); // Basil
    expect(mapearCorParaGoogleColorId("#a4bdfc")).toBe("1"); // Lavender
  });

  it("mapeia uma cor arbitrária para o colorId mais próximo por distância RGB", () => {
    // Amarelo dourado (#c9a96e, cor padrão da paleta do app) fica mais perto
    // de Banana (#fbd75b) ou Tangerine (#ffb878) do que de qualquer azul/verde.
    const resultado = mapearCorParaGoogleColorId("#c9a96e");
    expect(["5", "6"]).toContain(resultado);
  });

  it("retorna undefined para cor nula, indefinida ou vazia", () => {
    expect(mapearCorParaGoogleColorId(null)).toBeUndefined();
    expect(mapearCorParaGoogleColorId(undefined)).toBeUndefined();
    expect(mapearCorParaGoogleColorId("")).toBeUndefined();
  });

  it("retorna undefined para hex inválido, sem lançar", () => {
    expect(mapearCorParaGoogleColorId("nao-e-hex")).toBeUndefined();
    expect(mapearCorParaGoogleColorId("#fff")).toBeUndefined();
  });
});
