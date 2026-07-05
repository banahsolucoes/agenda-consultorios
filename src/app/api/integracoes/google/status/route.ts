import { NextResponse } from "next/server";
import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { obterClienteGoogleDaClinica, clinicaProntaParaCompartilhar } from "@/lib/google";

// GET /api/integracoes/google/status — estado da integração Google da
// clínica do usuário logado (conectado/desconectado + e-mail da conta
// conectada, quando possível obter, + se os escopos de Drive/Gmail já foram
// concedidos, para o botão de compartilhar pasta saber se pode habilitar).
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const clinica = await prisma.clinica.findUnique({ where: { id: usuario.clinicaId } });
  if (!clinica) return NextResponse.json({ erro: "clínica não encontrada" }, { status: 404 });

  if (!clinica.googleConectado) {
    return NextResponse.json({ conectado: false, prontoParaCompartilhar: false });
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
  } catch {
    // Best-effort de verdade: sem escopo de e-mail (conexões antigas, antes
    // do escopo userinfo.email) ou qualquer outra falha, só não mostramos o
    // e-mail — não é um erro que mereça poluir o log a cada checagem de status.
  }

  return NextResponse.json({
    conectado: true,
    email,
    calendarId: clinica.googleCalendarId,
    prontoParaCompartilhar: clinicaProntaParaCompartilhar(clinica),
  });
}
