import { describe, expect, it } from "vitest";
import {
  TEMPLATE_CONFIRMACAO_PADRAO,
  TEMPLATE_MEET_PADRAO,
  prepararTemplateMeet,
  removerLinhaSessaoPacote,
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
      nome: "William",
      data: "06/07",
      hora: "14:30",
      link: "https://meet.google.com/fnz-tood-zgt",
      numero: "3",
      total: "8",
    });

    expect(resultado).toBe(
      "Olá William!!!\n" +
        "Esse será o link para sua sessão no dia 06/07, às 14:30hr.\n" +
        "🔗 https://meet.google.com/fnz-tood-zgt 🔗\n" +
        "Sessão 3/8\n" +
        "Qualquer coisa, estou por aqui.\n" +
        "\n" +
        "Dai 🥰"
    );
  });

  it("não deixa nenhum placeholder sem substituir nos defaults", () => {
    const variaveis = {
      saudacao: "Bom dia",
      paciente: "William",
      nome: "William",
      data: "06/07",
      hora: "14:00",
      horarioLimite: "17:00",
      link: "https://meet.google.com/abc",
      numero: "3",
      total: "8",
      assistente: "Ana",
    };
    expect(renderizarTemplateMensagem(TEMPLATE_CONFIRMACAO_PADRAO, variaveis)).not.toMatch(/\{\w+\}/);
    expect(renderizarTemplateMensagem(TEMPLATE_MEET_PADRAO, variaveis)).not.toMatch(/\{\w+\}/);
  });
});

describe("removerLinhaSessaoPacote", () => {
  it("remove a linha inteira que contém {numero}/{total}, sem deixar linha em branco no lugar", () => {
    const resultado = removerLinhaSessaoPacote(TEMPLATE_MEET_PADRAO);
    expect(resultado).toBe(
      "Olá {nome}!!!\n" +
        "Esse será o link para sua sessão no dia {data}, às {hora}hr.\n" +
        "🔗 {link} 🔗\n" +
        "Qualquer coisa, estou por aqui.\n" +
        "\n" +
        "Dai 🥰"
    );
    expect(resultado).not.toContain("{numero}");
    expect(resultado).not.toContain("{total}");
  });

  it("renderizado sem a linha de pacote não deixa nenhum placeholder de sessão pra trás", () => {
    const semLinha = removerLinhaSessaoPacote(TEMPLATE_MEET_PADRAO);
    const resultado = renderizarTemplateMensagem(semLinha, {
      nome: "Débora",
      data: "20/08",
      hora: "11:30",
      link: "https://meet.google.com/xyz",
    });
    expect(resultado).not.toMatch(/\{\w+\}/);
    expect(resultado).not.toContain("Sessão");
  });
});

describe("prepararTemplateMeet", () => {
  it("ehAtendimentoUnico=true: linha vira 'Avaliação', sem contador", () => {
    const template = prepararTemplateMeet(TEMPLATE_MEET_PADRAO, {
      temPacote: true,
      ehAtendimentoUnico: true,
    });
    const resultado = renderizarTemplateMensagem(template, {
      nome: "Débora",
      data: "20/08",
      hora: "11:30",
      link: "https://meet.google.com/xyz",
    });

    expect(resultado).toContain("Avaliação");
    expect(resultado).not.toContain("Sessão 1/1");
    expect(resultado).not.toMatch(/\{\w+\}/);
  });

  it("ehAtendimentoUnico=false, com pacote: mantém 'Sessão {numero}/{total}' como hoje", () => {
    const template = prepararTemplateMeet(TEMPLATE_MEET_PADRAO, {
      temPacote: true,
      ehAtendimentoUnico: false,
    });
    const resultado = renderizarTemplateMensagem(template, {
      nome: "Débora",
      data: "20/08",
      hora: "11:30",
      link: "https://meet.google.com/xyz",
      numero: "3",
      total: "8",
    });

    expect(resultado).toContain("Sessão 3/8");
    expect(resultado).not.toContain("Avaliação");
  });

  it("sem pacote (reunião de mentorado): comportamento atual preservado, sem linha de contador", () => {
    const template = prepararTemplateMeet(TEMPLATE_MEET_PADRAO, {
      temPacote: false,
      ehAtendimentoUnico: false,
    });
    const resultado = renderizarTemplateMensagem(template, {
      nome: "Débora",
      data: "20/08",
      hora: "11:30",
      link: "https://meet.google.com/xyz",
    });

    expect(resultado).toBe(renderizarTemplateMensagem(removerLinhaSessaoPacote(TEMPLATE_MEET_PADRAO), {
      nome: "Débora",
      data: "20/08",
      hora: "11:30",
      link: "https://meet.google.com/xyz",
    }));
    expect(resultado).not.toContain("Sessão");
    expect(resultado).not.toContain("Avaliação");
    expect(resultado).not.toMatch(/\{\w+\}/);
  });
});
