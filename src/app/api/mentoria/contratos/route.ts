import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { exigirAcessoMentoria } from "@/lib/mentoria";

function parseData(valor: unknown): Date | null {
  if (valor === undefined || valor === null || valor === "") return null;
  const data = new Date(valor as string);
  return Number.isNaN(data.getTime()) ? null : data;
}

// POST /api/mentoria/contratos — cria contrato + parcelas atomicamente
export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ erro: "corpo da requisição inválido" }, { status: 400 });

  const { alunoId, pacote, valorTotal, totalParcelas, parcelas } = body;

  if (!alunoId || typeof alunoId !== "string") {
    return NextResponse.json({ erro: "alunoId é obrigatório" }, { status: 400 });
  }
  const aluno = await prisma.mentoriaAluno.findUnique({ where: { id: alunoId } });
  if (!aluno || aluno.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "aluno não encontrado" }, { status: 404 });
  }

  if (!pacote || typeof pacote !== "string") {
    return NextResponse.json({ erro: "pacote é obrigatório" }, { status: 400 });
  }
  if (typeof valorTotal !== "number" || !(valorTotal > 0)) {
    return NextResponse.json({ erro: "valorTotal deve ser um número maior que zero" }, { status: 400 });
  }
  const assinaturaContrato = parseData(body.assinaturaContrato);
  if (!assinaturaContrato) {
    return NextResponse.json({ erro: "assinaturaContrato é obrigatória e deve ser uma data válida" }, { status: 400 });
  }
  if (!Number.isInteger(totalParcelas) || totalParcelas < 1) {
    return NextResponse.json({ erro: "totalParcelas deve ser um inteiro maior ou igual a 1" }, { status: 400 });
  }

  let taxaImpostoPct: number | undefined;
  if (body.taxaImpostoPct !== undefined) {
    if (typeof body.taxaImpostoPct !== "number" || body.taxaImpostoPct < 0) {
      return NextResponse.json({ erro: "taxaImpostoPct deve ser um número maior ou igual a zero" }, { status: 400 });
    }
    taxaImpostoPct = body.taxaImpostoPct;
  }

  if (!Array.isArray(parcelas) || parcelas.length !== totalParcelas) {
    return NextResponse.json({ erro: "parcelas deve ter exatamente totalParcelas itens" }, { status: 400 });
  }

  const numerosVistos = new Set<number>();
  const parcelasValidadas: { numero: number; valorBruto: number; vencimento: Date }[] = [];
  for (const p of parcelas) {
    if (!Number.isInteger(p?.numero) || p.numero < 1 || p.numero > totalParcelas) {
      return NextResponse.json(
        { erro: `numero da parcela deve ser um inteiro entre 1 e ${totalParcelas}` },
        { status: 400 }
      );
    }
    if (numerosVistos.has(p.numero)) {
      return NextResponse.json({ erro: `numero de parcela repetido: ${p.numero}` }, { status: 400 });
    }
    numerosVistos.add(p.numero);

    if (typeof p.valorBruto !== "number" || !(p.valorBruto > 0)) {
      return NextResponse.json(
        { erro: `valorBruto da parcela ${p.numero} deve ser um número maior que zero` },
        { status: 400 }
      );
    }
    const vencimento = parseData(p.vencimento);
    if (!vencimento) {
      return NextResponse.json(
        { erro: `vencimento da parcela ${p.numero} é obrigatório e deve ser uma data válida` },
        { status: 400 }
      );
    }

    parcelasValidadas.push({ numero: p.numero, valorBruto: p.valorBruto, vencimento });
  }
  if (numerosVistos.size !== totalParcelas) {
    return NextResponse.json({ erro: `numeros de parcela devem ir de 1 a ${totalParcelas} sem repetição` }, { status: 400 });
  }

  const { contrato } = await prisma.$transaction(async (tx) => {
    const contrato = await tx.mentoriaContrato.create({
      data: {
        clinicaId: usuario.clinicaId,
        alunoId: aluno.id,
        pacote,
        valorTotal,
        ...(taxaImpostoPct !== undefined ? { taxaImpostoPct } : {}),
        assinaturaContrato,
        totalParcelas,
      },
    });

    await tx.mentoriaParcela.createMany({
      data: parcelasValidadas.map((p) => ({
        clinicaId: usuario.clinicaId,
        contratoId: contrato.id,
        numero: p.numero,
        valorBruto: p.valorBruto,
        vencimento: p.vencimento,
      })),
    });

    return { contrato };
  });

  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "CRIAR_CONTRATO_MENTORIA",
    `Criou o contrato "${pacote}" de ${aluno.nomeCompleto} (${totalParcelas} parcela${totalParcelas === 1 ? "" : "s"}, valor total ${valorTotal})`
  );

  return NextResponse.json(contrato, { status: 201 });
}
