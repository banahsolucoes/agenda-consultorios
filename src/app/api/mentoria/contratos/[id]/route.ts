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

// GET /api/mentoria/contratos/[id] — contrato + parcelas (ordenadas) + aluno
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const { id } = await ctx.params;
  const contrato = await prisma.mentoriaContrato.findUnique({
    where: { id },
    include: {
      aluno: true,
      parcelas: { orderBy: { numero: "asc" } },
    },
  });
  if (!contrato || contrato.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "contrato não encontrado" }, { status: 404 });
  }

  return NextResponse.json(contrato);
}

// PATCH /api/mentoria/contratos/[id] — edita o cabeçalho do contrato
// (pacote, valorTotal, taxaImpostoPct, assinaturaContrato). Só com o
// contrato ainda ATIVO.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const { id } = await ctx.params;
  const contrato = await prisma.mentoriaContrato.findUnique({ where: { id } });
  if (!contrato || contrato.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "contrato não encontrado" }, { status: 404 });
  }
  if (contrato.status !== "ATIVO") {
    return NextResponse.json({ erro: "contrato não está ativo — cabeçalho não pode ser editado" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ erro: "corpo da requisição inválido" }, { status: 400 });

  const data: Record<string, unknown> = {};

  if (body.pacote !== undefined) {
    if (!body.pacote || typeof body.pacote !== "string") {
      return NextResponse.json({ erro: "pacote não pode ser vazio" }, { status: 400 });
    }
    data.pacote = body.pacote;
  }
  if (body.valorTotal !== undefined) {
    if (typeof body.valorTotal !== "number" || !(body.valorTotal > 0)) {
      return NextResponse.json({ erro: "valorTotal deve ser um número maior que zero" }, { status: 400 });
    }
    data.valorTotal = body.valorTotal;
  }
  if (body.taxaImpostoPct !== undefined) {
    if (typeof body.taxaImpostoPct !== "number" || body.taxaImpostoPct < 0) {
      return NextResponse.json({ erro: "taxaImpostoPct deve ser um número maior ou igual a zero" }, { status: 400 });
    }
    data.taxaImpostoPct = body.taxaImpostoPct;
  }
  if (body.assinaturaContrato !== undefined) {
    const assinaturaContrato = parseData(body.assinaturaContrato);
    if (!assinaturaContrato) {
      return NextResponse.json({ erro: "assinaturaContrato deve ser uma data válida" }, { status: 400 });
    }
    data.assinaturaContrato = assinaturaContrato;
  }

  const camposAlterados = Object.keys(data);
  if (camposAlterados.length === 0) {
    return NextResponse.json({ erro: "nenhum campo para atualizar" }, { status: 400 });
  }

  const atualizado = await prisma.mentoriaContrato.update({ where: { id }, data });

  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "EDITAR_CONTRATO_MENTORIA",
    `Editou o cabeçalho do contrato "${atualizado.pacote}" (campos: ${camposAlterados.join(", ")})`
  );

  return NextResponse.json(atualizado);
}

// DELETE /api/mentoria/contratos/[id] — exclui contrato + parcelas + comissões.
// Contrato CANCELADO (já distratado): exclusão sempre permitida, em cascata.
// Contrato ATIVO: bloqueia (409) se houver parcela paga ou comissão já
// gerada — nesses casos a via correta é o distrato, não a exclusão direta.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const { id } = await ctx.params;
  const contrato = await prisma.mentoriaContrato.findUnique({
    where: { id },
    include: { parcelas: { select: { id: true, dataPagamento: true } }, comissoes: { select: { id: true } } },
  });
  if (!contrato || contrato.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "contrato não encontrado" }, { status: 404 });
  }

  if (contrato.status !== "CANCELADO") {
    const temParcelaPaga = contrato.parcelas.some((p) => p.dataPagamento !== null);
    const temComissao = contrato.comissoes.length > 0;
    if (temParcelaPaga || temComissao) {
      return NextResponse.json(
        {
          erro:
            "este contrato já tem pagamento e/ou comissão registrada — não pode ser excluído. Use o distrato para encerrá-lo.",
        },
        { status: 409 }
      );
    }
  }

  const qtdParcelas = contrato.parcelas.length;
  const qtdComissoes = contrato.comissoes.length;

  // Filhos antes do pai, respeitando as FKs — comissões e parcelas referenciam o contrato.
  await prisma.$transaction([
    prisma.mentoriaComissao.deleteMany({ where: { contratoId: id } }),
    prisma.mentoriaParcela.deleteMany({ where: { contratoId: id } }),
    prisma.mentoriaContrato.delete({ where: { id } }),
  ]);

  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "EXCLUIR_CONTRATO_MENTORIA",
    `Excluiu o contrato "${contrato.pacote}" (${qtdParcelas} parcela(s) e ${qtdComissoes} comissão(ões) removidas em cascata)`
  );

  return NextResponse.json({ ok: true, parcelasRemovidas: qtdParcelas, comissoesRemovidas: qtdComissoes });
}
