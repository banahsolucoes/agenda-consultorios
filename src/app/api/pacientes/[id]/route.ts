import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { obterClinicaECalendar } from "@/lib/google";
import { registrarLog } from "@/lib/auditoria";
import { pareceUrl } from "@/lib/validacao";
import { soDigitos } from "@/lib/importacao";

const CAMPOS_EDITAVEIS = [
  "nome",
  "telefone",
  "email",
  "cpf",
  "rg",
  "logradouro",
  "numero",
  "complemento",
  "bairro",
  "cidade",
  "estado",
  "cep",
  "quemIndicou",
  "dataNascimento",
  "estadoCivil",
  "nacionalidade",
  "profissao",
  "instagram",
  "pastaDriveUrl",
  "origemCadastro",
  "diaPreferido",
  "horarioFixo",
  "tipoSessaoId",
] as const;

const DIAS_VALIDOS = ["SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA", "SABADO", "DOMINGO"];
const ORIGENS_VALIDAS = ["MANUAL", "FORMS"];
const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const STATUS_GERAL_VALIDOS = ["ATIVO", "CANCELADO", "FINALIZADO"];

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
  if (body.pastaDriveUrl && !pareceUrl(body.pastaDriveUrl)) {
    return NextResponse.json({ erro: "pastaDriveUrl deve ser uma URL válida" }, { status: 400 });
  }
  if (body.statusGeral !== undefined && !STATUS_GERAL_VALIDOS.includes(body.statusGeral)) {
    return NextResponse.json({ erro: "statusGeral inválido" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  for (const campo of CAMPOS_EDITAVEIS) {
    if (body[campo] !== undefined) data[campo] = body[campo];
  }
  // Normaliza pra só dígitos antes de gravar — consistência com a
  // constraint @@unique([clinicaId, cpf]).
  if (body.cpf !== undefined) {
    data.cpf = soDigitos(String(body.cpf ?? "")) || null;
  }

  // Troca manual de status é reversível e não mexe em sessões: só atualiza o
  // rótulo e o carimbo de finalização (limpo quando sai de FINALIZADO).
  const statusAnterior = paciente.statusGeral;
  const statusAlterado = body.statusGeral !== undefined && body.statusGeral !== statusAnterior;
  if (statusAlterado) {
    data.statusGeral = body.statusGeral;
    data.finalizadoEm = body.statusGeral === "FINALIZADO" ? new Date() : null;
  }

  let atualizado;
  try {
    atualizado = await prisma.paciente.update({ where: { id }, data });
  } catch (err) {
    const codigo = (err as { code?: string } | null)?.code;
    if (codigo === "P2002") {
      return NextResponse.json({ erro: "CPF já cadastrado nesta clínica" }, { status: 409 });
    }
    throw err;
  }

  const camposAlterados = Object.keys(data).filter((campo) =>
    (CAMPOS_EDITAVEIS as readonly string[]).includes(campo)
  );
  if (camposAlterados.length > 0) {
    await registrarLog(
      usuario.clinicaId,
      usuario.id,
      "EDITAR_PACIENTE",
      `Editou o paciente ${atualizado.nome} (campos: ${camposAlterados.join(", ")})`
    );
  }
  if (statusAlterado) {
    await registrarLog(
      usuario.clinicaId,
      usuario.id,
      "ALTERAR_STATUS_PACIENTE",
      `Alterou o status de ${atualizado.nome} de ${statusAnterior} para ${atualizado.statusGeral}`
    );
  }

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
    const google = await obterClinicaECalendar(usuario.clinicaId);
    if (google) {
      for (const s of sessoesFuturasComEvento) {
        await google.calendar.events
          .delete({
            calendarId: s.googleCalendarId ?? google.clinica.googleCalendarId ?? "primary",
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

  await registrarLog(usuario.clinicaId, usuario.id, "EXCLUIR_PACIENTE", `Excluiu o paciente ${paciente.nome}`);

  return NextResponse.json({ ok: true });
}
