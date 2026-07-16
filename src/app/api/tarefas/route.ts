import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";

const TIPOS_MANUAIS_VALIDOS = ["CONTA"];
const RECORRENCIAS_VALIDAS = ["NENHUMA", "MENSAL"];

function parseDataOpcional(valor: unknown): Date | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null || valor === "") return null;
  const data = new Date(valor as string);
  return Number.isNaN(data.getTime()) ? undefined : data;
}

// POST /api/tarefas — cria uma tarefa manual (tipo CONTA) para a clínica logada
export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ erro: "corpo da requisição inválido" }, { status: 400 });

  const { tipo, titulo, descricao } = body;
  if (!TIPOS_MANUAIS_VALIDOS.includes(tipo)) {
    return NextResponse.json({ erro: "tipo inválido — só é permitido criar tarefas do tipo CONTA manualmente" }, { status: 400 });
  }
  if (!titulo || typeof titulo !== "string") {
    return NextResponse.json({ erro: "titulo é obrigatório" }, { status: 400 });
  }

  const recorrencia = body.recorrencia ?? "NENHUMA";
  if (!RECORRENCIAS_VALIDAS.includes(recorrencia)) {
    return NextResponse.json({ erro: "recorrencia inválida" }, { status: 400 });
  }

  const dataVencimento = parseDataOpcional(body.dataVencimento);
  if (dataVencimento === undefined && body.dataVencimento !== undefined) {
    return NextResponse.json({ erro: "dataVencimento inválida" }, { status: 400 });
  }
  const dataAviso = parseDataOpcional(body.dataAviso);
  if (dataAviso === undefined && body.dataAviso !== undefined) {
    return NextResponse.json({ erro: "dataAviso inválida" }, { status: 400 });
  }

  if (dataAviso && dataVencimento && dataAviso.getTime() > dataVencimento.getTime()) {
    return NextResponse.json({ erro: "dataAviso não pode ser depois de dataVencimento" }, { status: 400 });
  }

  const tarefa = await prisma.tarefa.create({
    data: {
      clinicaId: usuario.clinicaId,
      tipo,
      origem: "MANUAL",
      titulo,
      descricao: descricao ?? null,
      dataVencimento: dataVencimento ?? null,
      dataAviso: dataAviso ?? null,
      recorrencia,
      status: "PENDENTE",
      criadoPor: usuario.id,
    },
  });

  await registrarLog(usuario.clinicaId, usuario.id, "CRIAR_TAREFA", `Criou a tarefa "${tarefa.titulo}"`);

  return NextResponse.json(tarefa, { status: 201 });
}
