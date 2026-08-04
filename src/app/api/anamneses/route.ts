import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { podeProcessarAnamneses } from "@/lib/permissoes";
import { soDigitosCpf } from "@/lib/cpf";

const STATUS_VALIDOS = ["PENDENTE", "IGNORADO", "PROCESSADO"] as const;

// GET /api/anamneses?status=PENDENTE|IGNORADO|PROCESSADO — fila de envios do
// formulário público (F2), da clínica do usuário logado. Default PENDENTE.
// Para cada envio, indica se o CPF informado já bate com um Paciente da
// clínica ("paciente existente") ou não ("novo") — comparação por dígitos,
// nunca confia em formatação.
export async function GET(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!podeProcessarAnamneses(usuario.papel)) {
    return NextResponse.json({ erro: "permissão insuficiente" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status") ?? "PENDENTE";
  const status = (STATUS_VALIDOS as readonly string[]).includes(statusParam) ? statusParam : "PENDENTE";

  const envios = await prisma.envioFormulario.findMany({
    where: { clinicaId: usuario.clinicaId, status: status as (typeof STATUS_VALIDOS)[number] },
    orderBy: { criadoEm: "desc" },
    select: {
      id: true,
      criadoEm: true,
      status: true,
      observacaoProcessamento: true,
      formulario: { select: { titulo: true } },
      respostas: {
        where: { pergunta: { campoPaciente: { in: ["nome", "cpf"] } } },
        select: { valor: true, pergunta: { select: { campoPaciente: true } } },
      },
    },
  });

  if (envios.length === 0) return NextResponse.json([]);

  // CPFs digitados, normalizados só a dígitos, para casar contra Paciente.cpf
  // (a clínica pode ter cadastros antigos com CPF formatado de jeitos
  // diferentes — normaliza os dois lados antes de comparar).
  const pacientes = await prisma.paciente.findMany({
    where: { clinicaId: usuario.clinicaId, cpf: { not: null } },
    select: { id: true, nome: true, cpf: true },
  });
  const pacientesPorCpf = new Map<string, { id: string; nome: string }>();
  for (const p of pacientes) {
    const digitos = soDigitosCpf(p.cpf || "");
    if (digitos) pacientesPorCpf.set(digitos, { id: p.id, nome: p.nome });
  }

  const resultado = envios.map((e) => {
    const nomeInformado = e.respostas.find((r) => r.pergunta.campoPaciente === "nome")?.valor ?? null;
    const cpfResposta = e.respostas.find((r) => r.pergunta.campoPaciente === "cpf")?.valor ?? null;
    const cpfDigitos = cpfResposta ? soDigitosCpf(cpfResposta) : null;
    const match = cpfDigitos ? pacientesPorCpf.get(cpfDigitos) : undefined;

    return {
      id: e.id,
      criadoEm: e.criadoEm,
      status: e.status,
      observacaoProcessamento: e.observacaoProcessamento,
      formularioTitulo: e.formulario.titulo,
      nomeInformado,
      cpfDigitos,
      matchPacienteId: match?.id ?? null,
      matchPacienteNome: match?.nome ?? null,
    };
  });

  return NextResponse.json(resultado);
}
