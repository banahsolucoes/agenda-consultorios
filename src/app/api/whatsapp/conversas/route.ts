import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { normalizarTelefoneE164 } from "@/lib/whatsapp/telefone";

// GET /api/whatsapp/conversas — lista as conversas da clínica logada, mais
// recentes primeiro, com nome do paciente (quando vinculado) e a última
// mensagem pra preview na lista do inbox.
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(usuario.papel, "atenderWhatsapp")) {
    return NextResponse.json({ erro: "sem permissão" }, { status: 403 });
  }

  const conversas = await prisma.conversaWhatsapp.findMany({
    where: { clinicaId: usuario.clinicaId },
    include: {
      paciente: { select: { nome: true } },
      mensagens: { orderBy: { criadoEm: "desc" }, take: 1 },
    },
    orderBy: { ultimaMensagemEm: "desc" },
  });

  return NextResponse.json(
    conversas.map((c) => ({
      id: c.id,
      telefone: c.telefone,
      estado: c.estado,
      janelaAbertaAte: c.janelaAbertaAte,
      pacienteNome: c.paciente?.nome ?? null,
      ultimaMensagemEm: c.ultimaMensagemEm,
      ultimaMensagem: c.mensagens[0]
        ? { texto: c.mensagens[0].texto, direcao: c.mensagens[0].direcao }
        : null,
    }))
  );
}

// POST /api/whatsapp/conversas — { pacienteId } inicia (ou reaproveita) a
// conversa de um paciente selecionado no inbox, sem esperar a mensagem
// chegar pelo webhook primeiro. Se já existe ConversaWhatsapp pra esse
// (clinicaId, pacienteId), devolve ela — nunca duplica.
export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(usuario.papel, "atenderWhatsapp")) {
    return NextResponse.json({ erro: "sem permissão" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const pacienteId = typeof body?.pacienteId === "string" ? body.pacienteId : "";
  if (!pacienteId) return NextResponse.json({ erro: "pacienteId obrigatório" }, { status: 400 });

  const paciente = await prisma.paciente.findUnique({
    where: { id: pacienteId },
    select: { id: true, clinicaId: true, telefone: true },
  });
  if (!paciente || paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "paciente não encontrado" }, { status: 404 });
  }
  if (!paciente.telefone) {
    return NextResponse.json({ erro: "paciente sem telefone cadastrado" }, { status: 400 });
  }
  const telefoneE164 = normalizarTelefoneE164(paciente.telefone);
  if (!telefoneE164) {
    return NextResponse.json(
      { erro: `telefone do paciente fora do padrão E.164: "${paciente.telefone}"` },
      { status: 400 }
    );
  }

  const existente = await prisma.conversaWhatsapp.findFirst({
    where: { clinicaId: usuario.clinicaId, pacienteId },
  });
  if (existente) return NextResponse.json(existente);

  const agora = new Date();
  const conversa = await prisma.conversaWhatsapp.create({
    data: {
      clinicaId: usuario.clinicaId,
      pacienteId,
      telefone: telefoneE164,
      janelaAbertaAte: null,
      estado: "aberta",
      ultimaMensagemEm: agora,
    },
  });

  return NextResponse.json(conversa, { status: 201 });
}
