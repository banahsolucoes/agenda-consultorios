import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { carregarPromptLead, urlMidiaKit } from "./responderLead";

describe("responderLead", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("carrega as instruções do .md (mesmo caminho incluído no bundle da Vercel)", () => {
    const prompt = carregarPromptLead();
    expect(prompt).toContain("Instruções da IA — modo LEAD");
  });

  it("URL do mídia kit: APP_URL quando existir, senão o domínio padrão", () => {
    vi.stubEnv("APP_URL", "");
    expect(urlMidiaKit()).toBe("https://agenda.banahdigital.com.br/midia-kit-pamela-rachid.pdf");
    vi.stubEnv("APP_URL", "https://exemplo.com/");
    expect(urlMidiaKit()).toBe("https://exemplo.com/midia-kit-pamela-rachid.pdf");
  });
});
