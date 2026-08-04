import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { podeProcessarAnamneses } from "@/lib/permissoes";
import { soDigitosCpf } from "@/lib/cpf";

// GET /api/anamneses/[id] — detalhe completo de um envio: todas as
// respostas na ordem das perguntas (rotuloSnapshot, nunca o rótulo atual),
// consentimento, e um paciente sugerido por match de CPF (se houver) para
// a Ação B (vincular).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!podeProcessarAnamneses(usuario.papel)) {
    return NextResponse.json({ erro: "permissão insuficiente" }, { status: 403 });
  }

  const { id } = await params;

  const envio = await prisma.envioFormulario.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      criadoEm: true,
      pacienteId: true,
      consentimentoAceito: true,
      consentimentoEm: true,
      textoConsentimentoSnapshot: true,
      observacaoProcessamento: true,
      clinicaId: true,
      formulario: { select: { titulo: true } },
      respostas: {
        select: {
          id: true,
          valor: true,
          rotuloSnapshot: true,
          pergunta: { select: { ordem: true, campoPaciente: true } },
        },
      },
    },
  });

  if (!envio || envio.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "envio não encontrado" }, { status: 404 });
  }

  const respostas = [...envio.respostas].sort((a, b) => a.pergunta.ordem - b.pergunta.ordem);

  const camposPaciente: Record<string, string> = {};
  for (const r of respostas) {
    if (r.pergunta.campoPaciente) camposPaciente[r.pergunta.campoPaciente] = r.valor;
  }

  const cpfDigitos = camposPaciente.cpf ? soDigitosCpf(camposPaciente.cpf) : null;
  let pacienteSugerido: { id: string; nome: string; cpf: string | null } | null = null;
  if (cpfDigitos) {
    const candidatos = await prisma.paciente.findMany({
      where: { clinicaId: usuario.clinicaId, cpf: { not: null } },
      select: { id: true, nome: true, cpf: true },
    });
    const encontrado = candidatos.find((p) => soDigitosCpf(p.cpf || "") === cpfDigitos);
    if (encontrado) pacienteSugerido = encontrado;
  }

  return NextResponse.json({
    id: envio.id,
    status: envio.status,
    criadoEm: envio.criadoEm,
    pacienteId: envio.pacienteId,
    consentimentoAceito: envio.consentimentoAceito,
    consentimentoEm: envio.consentimentoEm,
    textoConsentimentoSnapshot: envio.textoConsentimentoSnapshot,
    observacaoProcessamento: envio.observacaoProcessamento,
    formularioTitulo: envio.formulario.titulo,
    respostas: respostas.map((r) => ({
      id: r.id,
      ordem: r.pergunta.ordem,
      rotuloSnapshot: r.rotuloSnapshot,
      valor: r.valor,
      campoPaciente: r.pergunta.campoPaciente,
    })),
    camposPaciente,
    pacienteSugerido,
  });
}
