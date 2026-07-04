import { NextResponse } from "next/server";
import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { obterClienteGoogleDaClinica } from "@/lib/google";

// GET /api/integracoes/google/status — estado da integração Google da
// clínica do usuário logado (conectado/desconectado + e-mail da conta
// conectada, quando possível obter).
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const clinica = await prisma.clinica.findUnique({ where: { id: usuario.clinicaId } });
  if (!clinica) return NextResponse.json({ erro: "clínica não encontrada" }, { status: 404 });

  if (!clinica.googleConectado) {
    return NextResponse.json({ conectado: false });
  }

  // Buscar o e-mail da conta é best-effort: se a chamada falhar (rede, token
  // revogado etc.) ainda respondemos "conectado" sem quebrar a tela.
  let email: string | null = null;
  try {
    const auth = await obterClienteGoogleDaClinica(clinica);
    if (auth) {
      const oauth2 = google.oauth2({ version: "v2", auth });
      const { data } = await oauth2.userinfo.get();
      email = data.email ?? null;
    }
  } catch (err) {
    console.error("Não foi possível obter a conta Google conectada:", err);
  }

  return NextResponse.json({ conectado: true, email, calendarId: clinica.googleCalendarId });
}
