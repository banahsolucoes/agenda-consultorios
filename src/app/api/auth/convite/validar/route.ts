import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimiteLocal } from "@/lib/rateLimit";

const LIMITE_POR_HORA = 30;
const JANELA_RATE_LIMIT_MS = 60 * 60 * 1000;

// Mesmo padrão de src/app/api/f/[clinicaSlug]/[formularioSlug]/route.ts e
// src/app/api/auth/signup/route.ts — x-forwarded-for primeiro, x-real-ip
// como fallback.
function obterIp(req: NextRequest): string {
  const encaminhado = req.headers.get("x-forwarded-for");
  if (encaminhado) return encaminhado.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "desconhecido";
}

// GET /api/auth/convite/validar?token=... — checagem pública usada pela
// tela /cadastro antes de mostrar o formulário. Responde só
// { valido, email?, nomeClinicaSugerido? }: nunca diz SE o token não existe,
// já expirou ou já foi usado — mesmo princípio do POST /api/auth/signup
// (respostaConviteInvalido), pra não virar ferramenta de enumeração de
// convites. Rota pública por estar sob /api/auth (ver proxy.ts/middleware.ts,
// ehRotaAuth já a exclui da exigência de sessão).
export async function GET(req: NextRequest) {
  const permitido = checkRateLimiteLocal(`auth-convite-validar:${obterIp(req)}`, LIMITE_POR_HORA, JANELA_RATE_LIMIT_MS);
  if (!permitido) {
    return NextResponse.json({ valido: false }, { status: 429 });
  }

  const token = req.nextUrl.searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.json({ valido: false });
  }

  const convite = await prisma.conviteClinica.findUnique({ where: { token } });

  const valido =
    convite !== null && convite.usadoEm === null && convite.expiraEm.getTime() > Date.now();

  if (!valido) {
    return NextResponse.json({ valido: false });
  }

  return NextResponse.json({
    valido: true,
    email: convite.email,
    nomeClinicaSugerido: convite.nomeClinicaSugerido ?? undefined,
  });
}
