import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { obterCalendarDaClinica } from "@/lib/google";

const CAMPOS_EDITAVEIS = [
  "nome",
  "telefone",
  "email",
  "cpf",
  "logradouro",
  "numero",
  "complemento",
  "bairro",
  "cidade",
  "estado",
  "cep",
  "quemIndicou",
  "origemCadastro",
  "diaPreferido",
  "horarioFixo",
  "tipoSessaoId",
] as const;

const DIAS_VALIDOS = ["SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA", "SABADO", "DOMINGO"];
const ORIGENS_VALIDAS = ["MANUAL", "FORMS"];
const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

// PATCH /api/pacientes/[id] — edita o cadastro de um paciente da clínica logada
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const paciente = await prisma.paciente.findUnique({ where: { id } });
  if (!paciente || paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "paciente não encontrado" }, { status: 404 });
  }

  const body = await req.json();

  if (body.diaPreferido !== undefined && !DIAS_VALIDOS.includes(body.diaPreferido)) {
    return NextResponse.json({ erro: "diaPreferido inválido" }, { status: 400 });
  }
  if (body.horarioFixo !== undefined && !HORA_REGEX.test(body.horarioFixo)) {
    return NextResponse.json({ erro: "horarioFixo deve estar no formato HH:MM" }, { status: 400 });
  }
  if (body.origemCadastro !== undefined && !ORIGENS_VALIDAS.includes(body.origemCadastro)) {
    return NextResponse.json({ erro: "origemCadastro inválida" }, { status: 400 });
  }
  if (body.tipoSessaoId) {
    const tipoSessao = await prisma.tipoSessao.findUnique({ where: { id: body.tipoSessaoId } });
    if (!tipoSessao || tipoSessao.clinicaId !== usuario.clinicaId) {
      return NextResponse.json({ erro: "tipoSessaoId inválido" }, { status: 400 });
    }
  }

  const data: Record<string, unknown> = {};
  for (const campo of CAMPOS_EDITAVEIS) {
    if (body[campo] !== undefined) data[campo] = body[campo];
  }

  const atualizado = await prisma.paciente.update({ where: { id }, data });
  return NextResponse.json(atualizado);
}

// DELETE /api/pacientes/[id] — exclui definitivamente o paciente e seu
// histórico (pacotes, sessões, consentimentos) da clínica logada. Ação
// irreversível — o operador já confirmou explicitamente na UI.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const paciente = await prisma.paciente.findUnique({ where: { id } });
  if (!paciente || paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "paciente não encontrado" }, { status: 404 });
  }

  // Remove os eventos do Google Calendar das sessões futuras, melhor esforço
  // — falha na integração nunca impede a exclusão do paciente.
  const sessoesFuturasComEvento = await prisma.agendamento.findMany({
    where: { pacienteId: id, googleEventId: { not: null }, inicio: { gte: new Date() } },
  });
  if (sessoesFuturasComEvento.length > 0) {
    const clinica = await prisma.clinica.findUnique({ where: { id: usuario.clinicaId } });
    const calendar = clinica ? await obterCalendarDaClinica(clinica).catch(() => null) : null;
    if (calendar) {
      for (const s of sessoesFuturasComEvento) {
        await calendar.events
          .delete({
            calendarId: s.googleCalendarId ?? clinica?.googleCalendarId ?? "primary",
            eventId: s.googleEventId!,
          })
          .catch((err) => console.error("Falha ao remover evento do Google Calendar:", err));
      }
    }
  }

  await prisma.$transaction([
    prisma.agendamento.deleteMany({ where: { pacienteId: id } }),
    prisma.consentimento.deleteMany({ where: { pacienteId: id } }),
    prisma.pacote.deleteMany({ where: { pacienteId: id } }),
    prisma.paciente.delete({ where: { id } }),
  ]);

  return NextResponse.json({ ok: true });
}
