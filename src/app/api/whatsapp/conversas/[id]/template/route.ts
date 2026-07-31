import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { getProvider } from "@/lib/whatsapp/provider";
import { formatarDataCurtaSP, formatarHoraSP } from "@/lib/timezone";

// POST /api/whatsapp/conversas/[id]/template — inicia contato quando a
// janela de 24h está fechada (texto livre seria rejeitado pela Meta):
// envia o template já aprovado "confirmacao_agenda", preenchido a partir do
// próximo Agendamento futuro do paciente. Sem agendamento futuro, não tem
// como preencher o template (e não existe um template genérico aprovado
// pra esse caso) — retorna erro claro em vez de tentar.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(usuario.papel, "atenderWhatsapp")) {
    return NextResponse.json({ erro: "sem permissão" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const conversa = await prisma.conversaWhatsapp.findUnique({ where: { id } });
  if (!conversa || conversa.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "conversa não encontrada" }, { status: 404 });
  }
  if (!conversa.pacienteId) {
    return NextResponse.json({ erro: "conversa sem paciente vinculado" }, { status: 400 });
  }

  const paciente = await prisma.paciente.findUnique({
    where: { id: conversa.pacienteId },
    select: { nome: true },
  });
  if (!paciente) return NextResponse.json({ erro: "paciente não encontrado" }, { status: 404 });

  const proximoAgendamento = await prisma.agendamento.findFirst({
    where: {
      pacienteId: conversa.pacienteId,
      status: { in: ["AGENDADA", "REAGENDADA"] },
      inicio: { gte: new Date() },
    },
    orderBy: { inicio: "asc" },
  });
  if (!proximoAgendamento) {
    return NextResponse.json(
      {
        erro:
          "Paciente sem agendamento futuro — não é possível iniciar contato sem um template genérico aprovado.",
      },
      { status: 422 }
    );
  }

  const resultado = await getProvider().enviarTemplate({
    clinicaId: usuario.clinicaId,
    pacienteId: conversa.pacienteId,
    telefone: conversa.telefone,
    nome: paciente.nome,
    data: formatarDataCurtaSP(proximoAgendamento.inicio),
    hora: formatarHoraSP(proximoAgendamento.inicio),
  });

  if (!resultado.ok) {
    return NextResponse.json({ erro: resultado.erro }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
