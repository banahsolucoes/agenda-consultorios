import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { exigirAcessoMentoria, validarSomaLiquido } from "@/lib/mentoria";

function parseData(valor: unknown): Date | null {
  if (valor === undefined || valor === null || valor === "") return null;
  const data = new Date(valor as string);
  return Number.isNaN(data.getTime()) ? null : data;
}

function estaAberta(p: { dataPagamento: Date | null; estornoEm: Date | null }): boolean {
  return p.dataPagamento === null && p.estornoEm === null;
}

// PUT /api/mentoria/contratos/[id]/parcelas — recria/edita o conjunto de
// parcelas do contrato em lote. Parcelas fechadas (pagas/estornadas) não
// podem ter valor/vencimento alterados nem ser removidas do conjunto; a
// soma dos valorLiquido tem que bater com o valorTotal do contrato.
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const { id } = await ctx.params;
  const contrato = await prisma.mentoriaContrato.findUnique({
    where: { id },
    include: { parcelas: true },
  });
  if (!contrato || contrato.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "contrato não encontrado" }, { status: 404 });
  }
  if (contrato.status !== "ATIVO") {
    return NextResponse.json({ erro: "contrato não está ativo — parcelas não podem ser editadas" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.parcelas)) {
    return NextResponse.json({ erro: "parcelas é obrigatório e deve ser uma lista" }, { status: 400 });
  }
  const totalParcelas = body.parcelas.length;
  if (totalParcelas < 1) {
    return NextResponse.json({ erro: "é necessário ao menos uma parcela" }, { status: 400 });
  }

  const numerosVistos = new Set<number>();
  const parcelasValidadas: {
    id?: string;
    numero: number;
    valorBruto: number;
    valorLiquido: number;
    vencimento: Date;
  }[] = [];

  for (const p of body.parcelas) {
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
    if (typeof p.valorLiquido !== "number" || !(p.valorLiquido > 0)) {
      return NextResponse.json(
        { erro: `valorLiquido da parcela ${p.numero} é obrigatório e deve ser um número maior que zero` },
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
    if (p.id !== undefined && typeof p.id !== "string") {
      return NextResponse.json({ erro: `id da parcela ${p.numero} inválido` }, { status: 400 });
    }

    parcelasValidadas.push({
      id: p.id,
      numero: p.numero,
      valorBruto: p.valorBruto,
      valorLiquido: p.valorLiquido,
      vencimento,
    });
  }
  if (numerosVistos.size !== totalParcelas) {
    return NextResponse.json({ erro: `numeros de parcela devem ir de 1 a ${totalParcelas} sem repetição` }, { status: 400 });
  }

  // Nenhuma parcela fechada (paga/estornada) pode sumir do conjunto nem
  // mudar de valor/vencimento — só pode ter o numero realinhado.
  const idsNoPayload = new Set(parcelasValidadas.filter((p) => p.id).map((p) => p.id));
  for (const existente of contrato.parcelas) {
    if (!estaAberta(existente) && !idsNoPayload.has(existente.id)) {
      return NextResponse.json(
        { erro: `a parcela ${existente.numero} já está paga/estornada e não pode ser removida do conjunto` },
        { status: 409 }
      );
    }
  }

  const parcelasPorId = new Map(contrato.parcelas.map((p) => [p.id, p]));
  for (const p of parcelasValidadas) {
    if (!p.id) continue;
    const existente = parcelasPorId.get(p.id);
    if (!existente || existente.contratoId !== id) {
      return NextResponse.json({ erro: `parcela ${p.id} não encontrada neste contrato` }, { status: 404 });
    }
    if (!estaAberta(existente)) {
      const valorBrutoBate = Number(existente.valorBruto) === p.valorBruto;
      const valorLiquidoBate = existente.valorLiquido !== null && Number(existente.valorLiquido) === p.valorLiquido;
      const vencimentoBate = existente.vencimento.getTime() === p.vencimento.getTime();
      if (!valorBrutoBate || !valorLiquidoBate || !vencimentoBate) {
        return NextResponse.json(
          { erro: `a parcela ${existente.numero} já está paga/estornada e não pode ter valor/vencimento alterado` },
          { status: 409 }
        );
      }
    }
  }

  const somaLiquido = validarSomaLiquido(parcelasValidadas, Number(contrato.valorTotal));
  if (!somaLiquido.ok) {
    return NextResponse.json(
      {
        erro: `a soma dos valorLiquido (${somaLiquido.informado}) não bate com valorTotal (${somaLiquido.esperado})`,
        esperado: somaLiquido.esperado,
        informado: somaLiquido.informado,
        diferenca: somaLiquido.diferenca,
      },
      { status: 422 }
    );
  }

  const idsRemover = contrato.parcelas.filter((p) => !idsNoPayload.has(p.id)).map((p) => p.id);

  const parcelasAtualizadas = await prisma.$transaction(async (tx) => {
    if (idsRemover.length > 0) {
      await tx.mentoriaParcela.deleteMany({ where: { id: { in: idsRemover } } });
    }

    for (const p of parcelasValidadas) {
      if (p.id) {
        await tx.mentoriaParcela.update({
          where: { id: p.id },
          data: { numero: p.numero, valorBruto: p.valorBruto, valorLiquido: p.valorLiquido, vencimento: p.vencimento },
        });
      } else {
        await tx.mentoriaParcela.create({
          data: {
            clinicaId: usuario.clinicaId,
            contratoId: id,
            numero: p.numero,
            valorBruto: p.valorBruto,
            valorLiquido: p.valorLiquido,
            vencimento: p.vencimento,
          },
        });
      }
    }

    await tx.mentoriaContrato.update({ where: { id }, data: { totalParcelas } });

    return tx.mentoriaParcela.findMany({ where: { contratoId: id }, orderBy: { numero: "asc" } });
  });

  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "EDITAR_PARCELAS_CONTRATO_MENTORIA",
    `Editou o conjunto de parcelas do contrato "${contrato.pacote}" (${totalParcelas} parcela${totalParcelas === 1 ? "" : "s"})`
  );

  return NextResponse.json(parcelasAtualizadas);
}
