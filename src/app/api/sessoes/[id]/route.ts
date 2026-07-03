import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { verificarFinalizacao } from "@/lib/finalizacao";

const STATUS_CONSUMIDOS = ["REALIZADA", "NAO_REALIZADA"];
const DIA_NUM: Record<string, number> = {
  DOMINGO: 0, SEGUNDA: 1, TERCA: 2, QUARTA: 3, QUINTA: 4, SEXTA: 5, SABADO: 6,
};

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const sessao = await prisma.agendamento.findUnique({
    where: { id },
    include: { paciente: true },
  });
  if (!sessao || sessao.paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "sessão não encontrada" }, { status: 404 });
  }

  const body = await req.json();

  if (body.status) {
    const validos = ["AGENDADA", "REAGENDADA", "REALIZADA", "NAO_REALIZADA", "CANCELADA"];
    if (!validos.includes(body.status)) {
      return NextResponse.json({ erro: "status inválido" }, { status: 400 });
    }
    const atualizada = await prisma.agendamento.update({
      where: { id }, data: { status: body.status },
    });
    const finalizou = await verificarFinalizacao(sessao.pacoteId);
    return NextResponse.json({ ...atualizada, pacoteFinalizado: finalizou });
  }

  if (body.novoDia && body.novoHorario) {
    if (STATUS_CONSUMIDOS.includes(sessao.status)) {
      return NextResponse.json({ erro: "sessão consumida não pode ser editada" }, { status: 400 });
    }
    const diaAlvo = DIA_NUM[body.novoDia];
    if (diaAlvo === undefined) return NextResponse.json({ erro: "dia inválido" }, { status: 400 });

    const [h, m] = body.novoHorario.split(":").map(Number);
    if (isNaN(h) || isNaN(m) || h < 8 || (h === 19 && m > 30) || h > 19) {
      return NextResponse.json({ erro: "horário fora da agenda (08:00–19:30)" }, { status: 400 });
    }

    const d = new Date(sessao.inicio);
    const diaSem = d.getDay();
    const distSeg = diaSem === 0 ? 6 : diaSem - 1;
    const segunda = new Date(d);
    segunda.setDate(d.getDate() - distSeg);

    const novaData = new Date(segunda);
    novaData.setDate(segunda.getDate() + (diaAlvo - 1));
    novaData.setHours(h, m, 0, 0);

    const atualizada = await prisma.agendamento.update({
      where: { id }, data: { inicio: novaData, status: "AGENDADA" },
    });
    return NextResponse.json(atualizada);
  }

  return NextResponse.json({ erro: "nada para atualizar" }, { status: 400 });
}
