import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { exigirAcessoMentoria } from "@/lib/mentoria";

const FORMAS_PAGAMENTO = ["PIX", "CARTAO", "BOLETO", "DINHEIRO", "TRANSFERENCIA"];

function parseData(valor: unknown): Date | null {
  if (valor === undefined || valor === null || valor === "") return null;
  const data = new Date(valor as string);
  return Number.isNaN(data.getTime()) ? null : data;
}

// POST /api/mentoria/parcelas/[id]/baixa — registra o pagamento de uma
// parcela em aberto. Status "Pago" é derivado de dataPagamento != null, não
// existe campo de status persistido.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const { id } = await ctx.params;
  const parcela = await prisma.mentoriaParcela.findUnique({
    where: { id },
    include: { contrato: { select: { status: true } } },
  });
  if (!parcela || parcela.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "parcela não encontrada" }, { status: 404 });
  }

  const aberta = parcela.dataPagamento === null && parcela.estornoEm === null && parcela.contrato.status === "ATIVO";
  if (!aberta) {
    return NextResponse.json(
      { erro: "parcela não está aberta: já paga, estornada, ou contrato não está ativo" },
      { status: 409 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ erro: "corpo da requisição inválido" }, { status: 400 });

  const dataPagamento = parseData(body.dataPagamento);
  if (!dataPagamento) {
    return NextResponse.json({ erro: "dataPagamento é obrigatória e deve ser uma data válida" }, { status: 400 });
  }
  if (typeof body.valorLiquido !== "number" || !(body.valorLiquido > 0)) {
    return NextResponse.json({ erro: "valorLiquido é obrigatório e deve ser um número maior que zero" }, { status: 400 });
  }
  if (!FORMAS_PAGAMENTO.includes(body.formaPagamento)) {
    return NextResponse.json({ erro: "formaPagamento é obrigatória e deve ser um valor válido" }, { status: 400 });
  }

  const atualizada = await prisma.mentoriaParcela.update({
    where: { id },
    data: { dataPagamento, valorLiquido: body.valorLiquido, formaPagamento: body.formaPagamento },
  });

  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "BAIXAR_PARCELA_MENTORIA",
    `Registrou o pagamento da parcela ${atualizada.numero} do contrato ${atualizada.contratoId} (${body.formaPagamento}, valor líquido ${body.valorLiquido})`
  );

  return NextResponse.json(atualizada);
}
