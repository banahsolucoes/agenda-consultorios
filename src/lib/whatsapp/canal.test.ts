import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classificarCanal,
  credenciaisEnvio,
  decidirModo,
  ehNumeroTesteLead,
  parseNumerosTeste,
  type RegistroCanalWhatsApp,
} from "./canal";

const ENV_PNID = "1256071357582826";

function registro(parcial: Partial<RegistroCanalWhatsApp> = {}): RegistroCanalWhatsApp {
  return { id: "canal1", clinicaId: "clin1", phoneNumberId: "999", accessToken: "tok-canal", ativo: true, ...parcial };
}

describe("classificarCanal", () => {
  it("phone_number_id da env → AGENDA", () => {
    expect(classificarCanal(ENV_PNID, ENV_PNID, null)).toEqual({ tipo: "AGENDA" });
  });

  it("env tem prioridade mesmo se houver CanalWhatsApp com o mesmo id", () => {
    expect(classificarCanal(ENV_PNID, ENV_PNID, registro({ phoneNumberId: ENV_PNID }))).toEqual({ tipo: "AGENDA" });
  });

  it("CanalWhatsApp ativo → LEAD da clínica do canal", () => {
    expect(classificarCanal("999", ENV_PNID, registro())).toEqual({
      tipo: "LEAD",
      canalId: "canal1",
      clinicaId: "clin1",
      phoneNumberId: "999",
      accessToken: "tok-canal",
    });
  });

  it("CanalWhatsApp inativo → null", () => {
    expect(classificarCanal("999", ENV_PNID, registro({ ativo: false }))).toBeNull();
  });

  it("número desconhecido → null", () => {
    expect(classificarCanal("123", ENV_PNID, null)).toBeNull();
  });

  it("env não configurada não casa com nada", () => {
    expect(classificarCanal("123", undefined, null)).toBeNull();
    expect(classificarCanal("", undefined, null)).toBeNull();
  });

  it("registro de outro phoneNumberId não é aceito", () => {
    expect(classificarCanal("123", ENV_PNID, registro({ phoneNumberId: "999" }))).toBeNull();
  });
});

describe("números de teste do modo LEAD", () => {
  it("parse: vírgula, espaços, normalização e descarte de inválidos", () => {
    const numeros = parseNumerosTeste(" 5511993944786, 11 98888-7777 ,, 123 ");
    expect([...numeros].sort()).toEqual(["5511988887777", "5511993944786"]);
  });

  it("env ausente ou vazia → lista vazia", () => {
    expect(parseNumerosTeste(undefined).size).toBe(0);
    expect(parseNumerosTeste("").size).toBe(0);
  });

  it("remetente bate com a lista após normalizar os dois lados", () => {
    const numeros = parseNumerosTeste("11993944786");
    expect(ehNumeroTesteLead("5511993944786", numeros)).toBe(true);
    expect(ehNumeroTesteLead("5511900000000", numeros)).toBe(false);
    expect(ehNumeroTesteLead("abc", numeros)).toBe(false);
  });

  it("canal AGENDA: número de teste → LEAD, demais → AGENDA", () => {
    const numeros = parseNumerosTeste("5511993944786");
    expect(decidirModo({ tipo: "AGENDA" }, "5511993944786", numeros)).toBe("LEAD");
    expect(decidirModo({ tipo: "AGENDA" }, "5511919395401", numeros)).toBe("AGENDA");
  });

  it("canal AGENDA sem lista configurada → sempre AGENDA", () => {
    expect(decidirModo({ tipo: "AGENDA" }, "5511993944786", parseNumerosTeste(undefined))).toBe("AGENDA");
  });

  it("canal LEAD → sempre LEAD, com ou sem lista", () => {
    const lead = classificarCanal("999", ENV_PNID, registro())!;
    expect(decidirModo(lead, "5511919395401", new Set())).toBe("LEAD");
  });
});

describe("credenciaisEnvio", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sem canal ou canal AGENDA → envs", () => {
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", ENV_PNID);
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "tok-env");
    const esperado = { phoneNumberId: ENV_PNID, accessToken: "tok-env" };
    expect(credenciaisEnvio()).toEqual(esperado);
    expect(credenciaisEnvio({ tipo: "AGENDA" })).toEqual(esperado);
  });

  it("envs ausentes → null", () => {
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
    expect(credenciaisEnvio()).toBeNull();
  });

  it("canal LEAD → credenciais do próprio canal, ignorando envs", () => {
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", ENV_PNID);
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "tok-env");
    const lead = classificarCanal("999", ENV_PNID, registro())!;
    expect(credenciaisEnvio(lead)).toEqual({ phoneNumberId: "999", accessToken: "tok-canal" });
  });
});
