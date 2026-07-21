import { describe, expect, it } from "vitest";
import {
  TEMPLATE_CONFIRMACAO_PADRAO,
  TEMPLATE_MEET_PADRAO,
  renderizarTemplateMensagem,
  saudacaoAtual,
} from "./templatesMensagem";

// Instantes fixos em UTC cujo horário de parede em São Paulo (UTC-3) caem
// exatamente nas fronteiras de cada saudação.
describe("saudacaoAtual", () => {
  it("retorna Bom dia de 00h a 11h59 (SP)", () => {
    expect(saudacaoAtual(new Date("2026-07-07T03:00:00.000Z"))).toBe("Bom dia"); // 00:00 SP
    expect(saudacaoAtual(new Date("2026-07-07T14:59:00.000Z"))).toBe("Bom dia"); // 11:59 SP
  });

  it("retorna Boa tarde de 12h a 17h59 (SP)", () => {
    expect(saudacaoAtual(new Date("2026-07-07T15:00:00.000Z"))).toBe("Boa tarde"); // 12:00 SP
    expect(saudacaoAtual(new Date("2026-07-07T20:59:00.000Z"))).toBe("Boa tarde"); // 17:59 SP
  });

  it("retorna Boa noite de 18h a 23h59 (SP)", () => {
    expect(saudacaoAtual(new Date("2026-07-07T21:00:00.000Z"))).toBe("Boa noite"); // 18:00 SP
    expect(saudacaoAtual(new Date("2026-07-08T02:59:00.000Z"))).toBe("Boa noite"); // 23:59 SP
  });
});

describe("renderizarTemplateMensagem", () => {
  it("substitui todas as variáveis do template de confirmação, mantendo as quebras de linha", () => {
    const resultado = renderizarTemplateMensagem(TEMPLATE_CONFIRMACAO_PADRAO, {
      saudacao: "Bom dia",
      paciente: "William",
      data: "06/07",
      hora: "14:00",
      horarioLimite: "17:00",
      assistente: "Ana",
    });

    expect(resultado).toBe(
      "Bom dia William, tudo bem?! \n" +
        "🌸 Passando para confirmar sua sessão no dia 06/07 às 14:00hr. 🗓\n" +
        "👉 Podemos confirmar? ✅\n" +
        "⸻\n" +
        "⚠️ Importante\n" +
        "Caso não haja confirmação até hoje, às 17:00hr, o horário será automaticamente cancelado.\n" +
        "Um abraço\n" +
        "\n" +
        "Ana 🥰"
    );
  });

  it("substitui todas as variáveis do template do Meet, mantendo as quebras de linha", () => {
    const resultado = renderizarTemplateMensagem(TEMPLATE_MEET_PADRAO, {
      saudacao: "Boa tarde",
      paciente: "William",
      hora: "14:30",
      linkMeet: "https://meet.google.com/fnz-tood-zgt",
      assistente: "Ana",
    });

    expect(resultado).toBe(
      "Boa tarde William, tudo bem? ☀️\n" +
        "\n" +
        "Segue o link da sua sessão de hoje às 14:30h.\n" +
        "🔗 https://meet.google.com/fnz-tood-zgt 🔗\n" +
        "\n" +
        "Qualquer coisa, estou por aqui.\n" +
        "\n" +
        "Ana 🥰"
    );
  });

  it("não deixa nenhum placeholder sem substituir nos defaults", () => {
    const variaveis = {
      saudacao: "Bom dia",
      paciente: "William",
      data: "06/07",
      hora: "14:00",
      horarioLimite: "17:00",
      linkMeet: "https://meet.google.com/abc",
      assistente: "Ana",
    };
    expect(renderizarTemplateMensagem(TEMPLATE_CONFIRMACAO_PADRAO, variaveis)).not.toMatch(/\{\w+\}/);
    expect(renderizarTemplateMensagem(TEMPLATE_MEET_PADRAO, variaveis)).not.toMatch(/\{\w+\}/);
  });
});
