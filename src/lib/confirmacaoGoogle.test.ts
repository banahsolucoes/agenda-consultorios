import { describe, expect, it, vi } from "vitest";
import { sincronizarEventoGoogle } from "@/lib/google";
import { primeiroUltimoNome } from "@/lib/nomes";

// Reproduz exatamente a construção de título usada no bloco `confirmada`
// de PATCH /api/sessoes/[id] — valida que marcar/desmarcar (inclusive
// repetido) nunca duplica nem deixa de remover o ✅, já que o título é
// sempre reconstruído do zero, nunca concatenado ao título antigo.
function tituloConfirmacao(nome: string, numeroSessao: number, totalPacote: number, confirmada: boolean) {
  return `${primeiroUltimoNome(nome)} (${numeroSessao}/${totalPacote})${confirmada ? " ✅" : ""}`;
}

describe("confirmação de sessão refletida no título do evento Google", () => {
  it("adiciona o ✅ ao marcar confirmada=true", async () => {
    const patch = vi.fn().mockResolvedValue({});
    const calendar = { events: { patch } } as unknown as Parameters<typeof sincronizarEventoGoogle>[0];

    const titulo = tituloConfirmacao("William Silva", 12, 12, true);
    await sincronizarEventoGoogle(
      calendar,
      "primary",
      "evt-1",
      { inicio: new Date("2026-07-10T16:00:00.000Z"), duracaoMin: 45, titulo },
      "clinica-teste"
    );

    expect(titulo).toBe("William Silva (12/12) ✅");
    expect(patch.mock.calls[0][0].requestBody.summary).toBe("William Silva (12/12) ✅");
  });

  it("não duplica o ✅ ao marcar confirmada=true duas vezes seguidas", () => {
    const t1 = tituloConfirmacao("William Silva", 12, 12, true);
    const t2 = tituloConfirmacao("William Silva", 12, 12, true);
    expect(t1).toBe(t2);
    expect((t2.match(/✅/g) ?? []).length).toBe(1);
  });

  it("remove o ✅ ao desmarcar confirmada=false, voltando ao título original", async () => {
    const patch = vi.fn().mockResolvedValue({});
    const calendar = { events: { patch } } as unknown as Parameters<typeof sincronizarEventoGoogle>[0];

    const titulo = tituloConfirmacao("William Silva", 12, 12, false);
    await sincronizarEventoGoogle(
      calendar,
      "primary",
      "evt-1",
      { inicio: new Date("2026-07-10T16:00:00.000Z"), duracaoMin: 45, titulo },
      "clinica-teste"
    );

    expect(titulo).toBe("William Silva (12/12)");
    expect(titulo.includes("✅")).toBe(false);
    expect(patch.mock.calls[0][0].requestBody.summary).toBe("William Silva (12/12)");
  });

  it("usa timeZone America/Sao_Paulo no start/end do patch", async () => {
    const patch = vi.fn().mockResolvedValue({});
    const calendar = { events: { patch } } as unknown as Parameters<typeof sincronizarEventoGoogle>[0];

    await sincronizarEventoGoogle(
      calendar,
      "primary",
      "evt-1",
      { inicio: new Date("2026-07-10T16:00:00.000Z"), duracaoMin: 45, titulo: "William Silva (12/12) ✅" },
      "clinica-teste"
    );

    const body = patch.mock.calls[0][0].requestBody;
    expect(body.start.timeZone).toBe("America/Sao_Paulo");
    expect(body.end.timeZone).toBe("America/Sao_Paulo");
  });

  it("nunca lança se o Google falhar (best-effort)", async () => {
    const patch = vi.fn().mockRejectedValue(new Error("boom"));
    const calendar = { events: { patch } } as unknown as Parameters<typeof sincronizarEventoGoogle>[0];

    await expect(
      sincronizarEventoGoogle(
        calendar,
        "primary",
        "evt-1",
        { inicio: new Date(), duracaoMin: 45, titulo: "William Silva (12/12) ✅" },
        "clinica-teste"
      )
    ).resolves.toBe(false);
  });
});
