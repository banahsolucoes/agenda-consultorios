import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { exigirAcessoMentoria, arred2, numOrZero } from "@/lib/mentoria";

// GET /api/mentoria/dashboard/alunos — contratos ATIVOS com acompanhamento
// de recebimento (só leitura).
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const contratos = await prisma.mentoriaContrato.findMany({
    where: { clinicaId: usuario.clinicaId, status: "ATIVO" },
    include: { aluno: { select: { nomeCompleto: true } }, parcelas: true },
    orderBy: { criadoEm: "asc" },
  });

  const linhas = contratos.map((c) => {
    const recebidas = c.parcelas.filter((p) => p.dataPagamento !== null && p.estornoEm === null);
    // Contrato já é ATIVO (filtro acima), então toda parcela ainda não paga/
    // estornada conta como "a receber", igual à definição da Fase 4A.
    const aReceber = c.parcelas.filter((p) => p.dataPagamento === null && p.estornoEm === null);

    const parcelaAtual = recebidas.reduce((maior, p) => Math.max(maior, p.numero), 0);
    const recebidoAcumulado = arred2(recebidas.reduce((soma, p) => soma + numOrZero(p.valorLiquido), 0));
    const saldoAReceber = arred2(aReceber.reduce((soma, p) => soma + numOrZero(p.valorBruto), 0));

    return {
      alunoNome: c.aluno.nomeCompleto,
      contratoId: c.id,
      pacote: c.pacote,
      valorTotal: numOrZero(c.valorTotal),
      parcelaAtual,
      totalParcelas: c.totalParcelas,
      recebidoAcumulado,
      saldoAReceber,
    };
  });

  return NextResponse.json(linhas);
}
