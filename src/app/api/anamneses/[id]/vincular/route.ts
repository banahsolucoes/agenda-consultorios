import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { podeProcessarAnamneses } from "@/lib/permissoes";
import { montarAnamneseDeRespostas } from "@/lib/importacao";
import { formatarDataCompletaSP } from "@/lib/timezone";
import { registrarLog } from "@/lib/auditoria";

// Campos cadastrais que "Complementar cadastro" pode preencher — só quando
// o Paciente está vazio nesse campo; nunca sobrescreve valor existente.
const CAMPOS_COMPLEMENTAVEIS = [
  "telefone",
  "email",
  "rg",
  "logradouro",
  "cep",
  "quemIndicou",
  "dataNascimento",
  "estadoCivil",
  "nacionalidade",
  "profissao",
  "instagram",
] as const;

class ConflitoProcessamento extends Error {}
class DivergenciaPreservacao extends Error {}

// POST /api/anamneses/[id]/vincular — Ação B da fila (F2.5): vincula um
// EnvioFormulario PENDENTE a um Paciente já cadastrado (sugerido por match
// de CPF ou escolhido manualmente pela Daiane — nunca automático). A
// anamnese nova é SEMPRE anexada como bloco datado no topo, o conteúdo
// anterior é preservado por inteiro, nunca substituído.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!podeProcessarAnamneses(usuario.papel)) {
    return NextResponse.json({ erro: "permissão insuficiente" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const pacienteId = body?.pacienteId;
  const complementarCadastro = body?.complementarCadastro === true;
  if (!pacienteId || typeof pacienteId !== "string") {
    return NextResponse.json({ erro: "pacienteId é obrigatório" }, { status: 400 });
  }

  const envio = await prisma.envioFormulario.findUnique({
    where: { id },
    select: {
      id: true,
      clinicaId: true,
      status: true,
      respostas: {
        select: {
          rotuloSnapshot: true,
          valor: true,
          pergunta: { select: { ordem: true, campoPaciente: true } },
        },
      },
    },
  });
  if (!envio || envio.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "envio não encontrado" }, { status: 404 });
  }
  if (envio.status !== "PENDENTE") {
    return NextResponse.json({ erro: "este envio já foi processado" }, { status: 409 });
  }

  const paciente = await prisma.paciente.findUnique({ where: { id: pacienteId } });
  if (!paciente || paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "paciente não encontrado" }, { status: 404 });
  }

  const respostasOrdenadas = [...envio.respostas].sort((a, b) => a.pergunta.ordem - b.pergunta.ordem);
  const anamneseAnterior = paciente.anamnese ?? "";
  const blocoNovo = `=== ANAMNESE ${formatarDataCompletaSP(new Date())} ===\n${montarAnamneseDeRespostas(respostasOrdenadas)}`;
  const novoTexto = blocoNovo + anamneseAnterior;

  // Garantia obrigatória: o conteúdo anterior nunca pode mudar, nem um
  // byte — recompara em código antes de gravar (mesmo padrão de
  // scripts/reprocessar-anamnese.ts).
  const caudaGravada = novoTexto.slice(novoTexto.length - anamneseAnterior.length);
  if (caudaGravada !== anamneseAnterior) {
    return NextResponse.json(
      { erro: "divergência na preservação da anamnese anterior — nada foi gravado" },
      { status: 500 }
    );
  }

  const dadosComplementares: Record<string, string> = {};
  if (complementarCadastro) {
    const camposPaciente: Record<string, string> = {};
    for (const r of respostasOrdenadas) {
      if (r.pergunta.campoPaciente) camposPaciente[r.pergunta.campoPaciente] = r.valor;
    }
    for (const campo of CAMPOS_COMPLEMENTAVEIS) {
      const valorAtualPaciente = (paciente as unknown as Record<string, string | null>)[campo];
      const valorEnvio = camposPaciente[campo];
      if (!valorAtualPaciente && valorEnvio) dadosComplementares[campo] = valorEnvio;
    }
  }

  try {
    const pacienteAtualizado = await prisma.$transaction(async (tx) => {
      const guarda = await tx.envioFormulario.updateMany({
        where: { id: envio.id, status: "PENDENTE" },
        data: { status: "PROCESSADO" },
      });
      if (guarda.count !== 1) throw new ConflitoProcessamento();

      // Reconfirma dentro da transação que o texto lido antes de começar
      // ainda é o texto atual — evita perder uma edição concorrente da
      // anamnese (ex.: alguém editando pelo modal ao mesmo tempo).
      const pacienteAtual = await tx.paciente.findUnique({
        where: { id: pacienteId },
        select: { anamnese: true },
      });
      if ((pacienteAtual?.anamnese ?? "") !== anamneseAnterior) {
        throw new DivergenciaPreservacao();
      }

      const atualizado = await tx.paciente.update({
        where: { id: pacienteId },
        data: { anamnese: novoTexto, ...dadosComplementares },
      });

      await tx.envioFormulario.update({
        where: { id: envio.id },
        data: { pacienteId },
      });

      return atualizado;
    });

    await registrarLog(
      usuario.clinicaId,
      usuario.id,
      "VINCULAR_ANAMNESE_A_PACIENTE",
      `Anexou anamnese do envio ${envio.id} ao paciente ${pacienteAtualizado.nome}`
    );

    return NextResponse.json(pacienteAtualizado);
  } catch (err) {
    if (err instanceof ConflitoProcessamento) {
      return NextResponse.json({ erro: "este envio já foi processado" }, { status: 409 });
    }
    if (err instanceof DivergenciaPreservacao) {
      return NextResponse.json(
        { erro: "a anamnese do paciente mudou entre a leitura e a gravação — tente novamente" },
        { status: 409 }
      );
    }
    throw err;
  }
}
