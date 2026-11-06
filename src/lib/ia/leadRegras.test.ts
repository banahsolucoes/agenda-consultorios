import { describe, expect, it } from "vitest";
import {
  MAX_RESPOSTAS_IA_POR_CONVERSA,
  contarRespostasIa,
  iaLeadHabilitada,
  montarContexto,
  montarHistorico,
  motivoParaNaoResponder,
  normalizarSaidaLead,
  truncar,
} from "./leadRegras";

const base = { mensagens: [], enviarMidiaKit: false, passarParaHumano: null, encerrar: false };

describe("normalizarSaidaLead", () => {
  it("aceita JSON válido em string", () => {
    const saida = normalizarSaidaLead(
      JSON.stringify({ ...base, mensagens: [{ texto: "Oi!", botoes: ["QUERO", "AGORA NÃO"] }] })
    );
    expect(saida).toEqual({ ...base, mensagens: [{ texto: "Oi!", botoes: ["QUERO", "AGORA NÃO"] }] });
  });

  it("JSON inválido → null", () => {
    expect(normalizarSaidaLead("{nao é json")).toBeNull();
    expect(normalizarSaidaLead(null)).toBeNull();
    expect(normalizarSaidaLead("[]")).toBeNull();
  });

  it("campos obrigatórios ausentes ou com tipo errado → null", () => {
    expect(normalizarSaidaLead({ mensagens: [] })).toBeNull();
    expect(normalizarSaidaLead({ ...base, mensagens: "oi" })).toBeNull();
    expect(normalizarSaidaLead({ ...base, encerrar: "sim" })).toBeNull();
    expect(normalizarSaidaLead({ ...base, mensagens: [{ texto: 1 }] })).toBeNull();
    expect(normalizarSaidaLead({ ...base, mensagens: [{ texto: "a", botoes: [1] }] })).toBeNull();
    expect(normalizarSaidaLead({ ...base, passarParaHumano: { resumo: 3 } })).toBeNull();
  });

  it("botões: corta em 20 caracteres, no máximo 3, sem vazios nem repetidos", () => {
    const saida = normalizarSaidaLead({
      ...base,
      mensagens: [
        {
          texto: "Escolha",
          botoes: ["  SIM  ", "", "SIM", "TIRAR DÚVIDAS COM A EQUIPE AGORA", "ONLINE", "PRESENCIAL"],
        },
      ],
    });
    expect(saida?.mensagens[0].botoes).toEqual(["SIM", "TIRAR DÚVIDAS COM A", "ONLINE"]);
    for (const b of saida!.mensagens[0].botoes) expect(Array.from(b).length).toBeLessThanOrEqual(20);
  });

  it("corte de botão não parte emoji ao meio", () => {
    expect(truncar("😊".repeat(25), 20)).toBe("😊".repeat(20));
  });

  it("no máximo 3 mensagens, descartando textos vazios", () => {
    const saida = normalizarSaidaLead({
      ...base,
      mensagens: [{ texto: " " }, { texto: "1" }, { texto: "2" }, { texto: "3" }, { texto: "4" }],
    });
    expect(saida?.mensagens.map((m) => m.texto)).toEqual(["1", "2", "3"]);
    expect(saida?.mensagens[0].botoes).toEqual([]);
  });

  it("corpo de mensagem com botões cortado em 1024", () => {
    const saida = normalizarSaidaLead({ ...base, mensagens: [{ texto: "a".repeat(2000), botoes: ["OK"] }] });
    expect(saida?.mensagens[0].texto.length).toBe(1024);
  });

  it("mantém ações", () => {
    const saida = normalizarSaidaLead({
      ...base,
      enviarMidiaKit: true,
      passarParaHumano: { resumo: " Maria, online, tarde " },
    });
    expect(saida?.enviarMidiaKit).toBe(true);
    expect(saida?.passarParaHumano).toEqual({ resumo: "Maria, online, tarde" });
  });
});

describe("iaLeadHabilitada", () => {
  it("default desligada", () => {
    expect(iaLeadHabilitada({})).toBe(false);
    expect(iaLeadHabilitada({ WHATSAPP_IA_LEAD_ATIVA: "false" })).toBe(false);
    expect(iaLeadHabilitada({ WHATSAPP_IA_LEAD_ATIVA: "1" })).toBe(false);
  });
  it("liga só com 'true' e kill switch geral não desligado", () => {
    expect(iaLeadHabilitada({ WHATSAPP_IA_LEAD_ATIVA: "true" })).toBe(true);
    expect(iaLeadHabilitada({ WHATSAPP_IA_LEAD_ATIVA: "true", WHATSAPP_IA_ATIVA: "true" })).toBe(true);
    expect(iaLeadHabilitada({ WHATSAPP_IA_LEAD_ATIVA: "true", WHATSAPP_IA_ATIVA: "false" })).toBe(false);
  });
});

describe("motivoParaNaoResponder", () => {
  const ok = { iaHabilitada: true, estadoConversa: "aberta", mensagemId: "m2", ultimaEntradaId: "m2" };

  it("responde quando tudo libera", () => {
    expect(motivoParaNaoResponder(ok)).toBeNull();
  });
  it("flag desligada", () => {
    expect(motivoParaNaoResponder({ ...ok, iaHabilitada: false })).toBe("ia_desligada");
  });
  it("conversa com humano ou encerrada", () => {
    expect(motivoParaNaoResponder({ ...ok, estadoConversa: "aguardando_humano" })).toBe("estado");
    expect(motivoParaNaoResponder({ ...ok, estadoConversa: "fechada" })).toBe("estado");
  });
  it("rajada: chegou mensagem mais nova", () => {
    expect(motivoParaNaoResponder({ ...ok, ultimaEntradaId: "m3" })).toBe("rajada");
    expect(motivoParaNaoResponder({ ...ok, ultimaEntradaId: null })).toBe("rajada");
  });
});

describe("contarRespostasIa", () => {
  it("conta blocos de saída da IA, não mensagens", () => {
    const e = { direcao: "entrada", texto: "x" };
    const ia = { direcao: "saida", texto: "y", respondidaPorIa: true };
    const humano = { direcao: "saida", texto: "z", respondidaPorIa: false };
    expect(contarRespostasIa([e, ia, ia, ia, e, ia, e, humano, e, ia])).toBe(3);
    expect(contarRespostasIa([])).toBe(0);
  });
  it("teto é 40", () => {
    expect(MAX_RESPOSTAS_IA_POR_CONVERSA).toBe(40);
  });
});

describe("montarHistorico", () => {
  it("junta falas seguidas, começa por user e marca mídia sem texto", () => {
    const turnos = montarHistorico([
      { direcao: "saida", texto: "Olá, modelo da planilha" },
      { direcao: "entrada", texto: "oi" },
      { direcao: "entrada", texto: "", tipo: "audio" },
      { direcao: "saida", texto: "a" },
      { direcao: "saida", texto: "b" },
      { direcao: "entrada", texto: "QUERO" },
    ]);
    expect(turnos).toEqual([
      { role: "user", content: "(conversa iniciada pela clínica)" },
      { role: "assistant", content: "Olá, modelo da planilha" },
      { role: "user", content: "oi\n[mensagem do tipo audio, sem texto]" },
      { role: "assistant", content: "a\nb" },
      { role: "user", content: "QUERO" },
    ]);
  });

  it("usa só as últimas N mensagens", () => {
    const msgs = Array.from({ length: 40 }, (_, i) => ({ direcao: i % 2 ? "saida" : "entrada", texto: `m${i}` }));
    const turnos = montarHistorico(msgs, 30);
    expect(turnos[0]).toEqual({ role: "user", content: "m10" });
    expect(turnos).toHaveLength(30);
  });
});

describe("montarContexto", () => {
  it("data e hora em São Paulo, nome e CTA", () => {
    const ctx = montarContexto({
      agora: new Date("2026-11-06T21:30:00Z"),
      nomeContato: "Maria",
      palavraCta: null,
      origem: "pessoa_escreveu",
    });
    expect(ctx).toContain("06/11/2026");
    expect(ctx).toContain("18:30");
    expect(ctx).toContain("Nome da pessoa: Maria");
    expect(ctx).toContain("Palavra do CTA: nenhuma");
    expect(ctx).toContain("a própria pessoa escreveu primeiro");
  });
});
