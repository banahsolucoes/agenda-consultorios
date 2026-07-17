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

// POST /api/mentoria/contratos — cria contrato + parcelas atomicamente
export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ erro: "corpo da requisição inválido" }, { status: 400 });

  const { alunoId, pacote, valorTotal, duracaoMeses, totalParcelas, parcelas, prorrogar } = body;

  if (!alunoId || typeof alunoId !== "string") {
    return NextResponse.json({ erro: "alunoId é obrigatório" }, { status: 400 });
  }
  const aluno = await prisma.mentoriaAluno.findUnique({ where: { id: alunoId } });
  if (!aluno || aluno.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "aluno não encontrado" }, { status: 404 });
  }

  // Regra: no máximo um contrato ATIVO por aluno. Prorrogar (Opção B) encerra
  // o contrato ativo atual e cria um novo — nunca apaga o anterior.
  const contratoAtivo = await prisma.mentoriaContrato.findFirst({
    where: { alunoId: aluno.id, clinicaId: usuario.clinicaId, status: "ATIVO" },
  });
  if (contratoAtivo && prorrogar !== true) {
    return NextResponse.json(
      {
        erro: `este aluno já tem um contrato ativo ("${contratoAtivo.pacote}") — use a ação "Prorrogar" para encerrá-lo e criar um novo`,
        contratoAtivoId: contratoAtivo.id,
      },
      { status: 409 }
    );
  }

  if (!pacote || typeof pacote !== "string") {
    return NextResponse.json({ erro: "pacote é obrigatório" }, { status: 400 });
  }
  if (typeof valorTotal !== "number" || !(valorTotal > 0)) {
    return NextResponse.json({ erro: "valorTotal deve ser um número maior que zero" }, { status: 400 });
  }
  if (!Number.isInteger(duracaoMeses) || duracaoMeses < 1) {
    return NextResponse.json({ erro: "duracaoMeses deve ser um inteiro maior ou igual a 1" }, { status: 400 });
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
  const parcelasValidadas: { numero: number; valorBruto: number; valorLiquido: number; vencimento: Date }[] = [];
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

    parcelasValidadas.push({ numero: p.numero, valorBruto: p.valorBruto, valorLiquido: p.valorLiquido, vencimento });
  }
  if (numerosVistos.size !== totalParcelas) {
    return NextResponse.json({ erro: `numeros de parcela devem ir de 1 a ${totalParcelas} sem repetição` }, { status: 400 });
  }

  const somaLiquido = validarSomaLiquido(parcelasValidadas, valorTotal);
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

  const { contrato } = await prisma.$transaction(async (tx) => {
    // Prorrogação (Opção B): encerra o contrato ativo atual — reaproveita o
    // status StatusContrato já existente (CONCLUIDO), nunca CANCELADO, pois
    // CANCELADO carrega semântica de distrato (zera comissões, libera
    // exclusão em cascata) que não se aplica aqui. Histórico preservado.
    if (contratoAtivo && prorrogar === true) {
      await tx.mentoriaContrato.update({
        where: { id: contratoAtivo.id },
        data: { status: "CONCLUIDO" },
      });
    }

    const contrato = await tx.mentoriaContrato.create({
      data: {
        clinicaId: usuario.clinicaId,
        alunoId: aluno.id,
        pacote,
        valorTotal,
        duracaoMeses,
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
        valorLiquido: p.valorLiquido,
        vencimento: p.vencimento,
      })),
    });

    return { contrato };
  });

  const prefixoLog =
    contratoAtivo && prorrogar === true
      ? `Prorrogou o contrato de ${aluno.nomeCompleto} (encerrou "${contratoAtivo.pacote}") — novo contrato "${pacote}"`
      : `Criou o contrato "${pacote}" de ${aluno.nomeCompleto}`;
  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "CRIAR_CONTRATO_MENTORIA",
    `${prefixoLog} (${totalParcelas} parcela${totalParcelas === 1 ? "" : "s"}, valor total ${valorTotal})`
  );

  return NextResponse.json(contrato, { status: 201 });
}
