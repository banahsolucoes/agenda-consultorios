import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { registrarLog } from "@/lib/auditoria";
import { enfileirar } from "@/lib/sincronizacao";
import { validarCadenciaLote } from "@/lib/conflitoSemana";
import {
  ErroCadencia,
  lerForcarCadencia,
  OPCOES_TRANSACAO_CADENCIA,
  registrarExcecaoCadencia,
  respostaCadencia,
  travarPaciente,
} from "@/lib/excecaoCadencia";

const DIA_MS = 24 * 60 * 60 * 1000;

class ErroAdiar extends Error {
  constructor(public status: number, mensagem: string) {
    super(mensagem);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(usuario.papel, "operarAgenda")) {
    return NextResponse.json({ erro: "sem permissão para esta ação" }, { status: 403 });
  }

  const { id: pacienteId } = await ctx.params;
  const paciente = await prisma.paciente.findUnique({ where: { id: pacienteId } });
  if (!paciente || paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "paciente não encontrado" }, { status: 404 });
  }

  const body = await req.json();
  const { sessaoCorteId } = body;
  if (!sessaoCorteId) {
    return NextResponse.json({ erro: "sessaoCorteId é obrigatório" }, { status: 400 });
  }

  const leituraForcar = lerForcarCadencia(body, usuario.papel);
  if (!leituraForcar.ok) return NextResponse.json({ erro: leituraForcar.erro }, { status: 400 });
  const forcar = leituraForcar.forcar;

  // Leitura, validação e escrita na mesma transação, sob o lock do paciente
  // (D9) — tudo ou nada.
  let corteNumero: number | null = null;
  const movimentos: { sessao: { id: string; googleEventId: string | null }; novaData: Date }[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      await travarPaciente(tx, pacienteId);

      // Todas as sessões do paciente (inclusive canceladas e de outros
      // pacotes) — as que não forem movidas são a base da cadência.
      const sessoes = await tx.agendamento.findMany({
        where: { pacienteId },
        orderBy: { numeroSessao: "asc" },
        include: { pacote: { select: { frequenciaSemanal: true } } },
      });

      const corte = sessoes.find((s) => s.id === sessaoCorteId && s.status !== "CANCELADA");
      if (!corte) throw new ErroAdiar(404, "sessão de corte não encontrada");
      corteNumero = corte.numeroSessao;

      // D5: só o pacote da sessão de corte — numeroSessao de pacotes
      // diferentes (ex.: renovação) se intercalam e não podem ser misturados.
      // pacienteId sempre não-nulo nesta query — toda sessão aqui é numerada
      // (vem de um pacote), nunca uma reunião avulsa de mentorado.
      const aMover = sessoes.filter(
        (s) =>
          s.status !== "CANCELADA" &&
          s.pacoteId === corte.pacoteId &&
          (s.numeroSessao ?? 0) >= (corte.numeroSessao ?? 0)
      );
      movimentos.push(...aMover.map((s) => ({ sessao: s, novaData: new Date(s.inicio.getTime() - 7 * DIA_MS) })));

      // Cadência: TODAS as sessões movidas (não só a de corte) contra as que
      // ficam e entre si, com o limite do pacote da sessão de corte (D1).
      // Recuar 7 dias preserva o padrão 2x.
      const limite = corte.pacote?.frequenciaSemanal ?? 1;
      const conflitos = validarCadenciaLote(
        aMover.map((s, i) => ({
          id: s.id,
          novaData: movimentos[i].novaData,
          limite,
          rotulo: `sessão ${s.numeroSessao}`,
        })),
        sessoes
      );
      if (conflitos.length > 0 && !forcar) throw new ErroCadencia(conflitos);

      for (const mov of movimentos) {
        await tx.agendamento.update({
          where: { id: mov.sessao.id },
          data: { inicio: mov.novaData, status: "AGENDADA" },
        });
      }
      if (conflitos.length > 0 && forcar) {
        await registrarExcecaoCadencia(tx, {
          clinicaId: usuario.clinicaId,
          usuarioId: usuario.id,
          pacienteId,
          operacao: `o trazer a partir da sessão ${corte.numeroSessao}`,
          motivo: forcar.motivo,
          conflitos,
        });
      }
    }, OPCOES_TRANSACAO_CADENCIA);
  } catch (err) {
    if (err instanceof ErroCadencia) return respostaCadencia(err, usuario.papel, "Não é possível trazer (nada foi movido)");
    if (err instanceof ErroAdiar) return NextResponse.json({ erro: err.message }, { status: err.status });
    throw err;
  }
  const aMover = movimentos.map((mov) => mov.sessao);
  // Atribuído dentro do callback da transação — o TS não acompanha isso.
  const numeroCorte = corteNumero as number | null;

  // Reflete a nova data/hora no Google Calendar de cada sessão movida — via
  // outbox: um item CALENDAR_ATUALIZAR se a sessão já tinha evento, ou
  // CALENDAR_CRIAR se nunca teve (mesmo gate de POST /api/pacotes: clínica
  // conectada, Meet só quando o tipo de atendimento é online — resolvido
  // pelo worker ao reler a sessão). enfileirar() é chamado sequencialmente
  // dentro do for (nunca em paralelo) pra preservar a ordem relativa do
  // loop na fila; cada item aponta pra uma sessão diferente, então não há
  // dependência real entre eles além dessa ordem de criação. Falha na
  // integração nunca desfaz o que já foi movido no banco; googleSyncStatus
  // vira PENDENTE (era SINCRONIZADO/FALHOU síncrono antes) pra distinguir
  // "aguardando" de "nunca tentou" — mesmo espírito do achado da auditoria
  // de 2026-07-23 (sessões do paciente Jadir ficaram com a data desatualizada
  // no Google porque a falha síncrona de então era só logada).
  const clinica = await prisma.clinica.findUnique({
    where: { id: usuario.clinicaId },
    select: { googleConectado: true },
  });
  if (clinica?.googleConectado) {
    for (const mov of movimentos) {
      await prisma.agendamento.update({
        where: { id: mov.sessao.id },
        data: { googleSyncStatus: "PENDENTE" },
      });
      await enfileirar(usuario.clinicaId, mov.sessao.googleEventId ? "CALENDAR_ATUALIZAR" : "CALENDAR_CRIAR", {
        agendamentoId: mov.sessao.id,
      });
    }
  }

  const sessaoOuSessoes = aMover.length === 1 ? "sessão" : "sessões";
  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "ADIAR",
    `Trouxe ${aMover.length} ${sessaoOuSessoes} de ${paciente.nome} a partir da sessão ${numeroCorte}`
  );

  return NextResponse.json({ adiadas: aMover.length, aPartirDe: numeroCorte });
}
