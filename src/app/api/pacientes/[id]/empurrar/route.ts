import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { componentesSP, criarDataSP, inicioSemanaSP } from "@/lib/timezone";
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

// Offset em dias a partir da segunda-feira (0) de cada dia da semana
const DIA_OFFSET: Record<string, number> = {
  SEGUNDA: 0,
  TERCA: 1,
  QUARTA: 2,
  QUINTA: 3,
  SEXTA: 4,
  SABADO: 5,
  DOMINGO: 6,
};
const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DIA_MS = 24 * 60 * 60 * 1000;

// Erro de validação simples lançado dentro da $transaction (rollback) e
// convertido em resposta pela rota.
class ErroEmpurrar extends Error {
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
  const semanas = Math.max(0, Math.min(10, Number(body.semanas) || 0));

  // novoDia/novoHorario são opcionais — quando informados, além de (opcionalmente)
  // empurrar N semanas, o dia da semana e o horário de cada sessão também são
  // trocados, mantendo a semana (segunda-domingo) de cada sessão.
  let diaAlvo: number | null = null;
  let horaAlvo: { h: number; m: number } | null = null;
  if (body.novoDia || body.novoHorario) {
    if (!body.novoDia || !(body.novoDia in DIA_OFFSET)) {
      return NextResponse.json({ erro: "novoDia inválido" }, { status: 400 });
    }
    if (!body.novoHorario || !HORA_REGEX.test(body.novoHorario)) {
      return NextResponse.json({ erro: "novoHorario deve estar no formato HH:MM" }, { status: 400 });
    }
    diaAlvo = DIA_OFFSET[body.novoDia];
    const [h, m] = body.novoHorario.split(":").map(Number);
    horaAlvo = { h, m };
  }

  // Com semanas=0 é preciso ao menos mudar dia/horário — senão não há o que fazer.
  if (semanas === 0 && diaAlvo === null) {
    return NextResponse.json({ erro: "informe semanas entre 1 e 10" }, { status: 400 });
  }

  // D4: com pacote 2x/semana ativo, trocar dia/horário jogaria as duas
  // sessões de cada semana no mesmo dia — recusado. Empurrar só em semanas
  // (+7 dias × N) preserva o padrão dos dois dias e continua permitido.
  if (diaAlvo !== null) {
    const pacote2x = await prisma.pacote.findFirst({
      where: { pacienteId, status: "ATIVO", frequenciaSemanal: 2 },
      select: { id: true },
    });
    if (pacote2x) {
      return NextResponse.json(
        {
          erro: "Este paciente tem atendimento 2x por semana: não é possível trocar o dia/horário pelo Empurrar. Empurre só em semanas, ou edite as sessões individualmente.",
        },
        { status: 400 }
      );
    }
  }

  const leituraForcar = lerForcarCadencia(body, usuario.papel);
  if (!leituraForcar.ok) return NextResponse.json({ erro: leituraForcar.erro }, { status: 400 });
  const forcar = leituraForcar.forcar;

  const agora = new Date();
  const hojeSP = componentesSP(agora);
  const hojeZero = criarDataSP(hojeSP.ano, hojeSP.mes, hojeSP.dia, 0, 0, 0);

  const movimentos: {
    id: string;
    numeroSessao: number | null;
    novaData: Date;
    googleEventId: string | null;
    limite: number;
  }[] = [];

  // Leitura, validação e escrita na mesma transação, sob o lock do paciente
  // (D9) — tudo ou nada.
  try {
    await prisma.$transaction(async (tx) => {
      await travarPaciente(tx, pacienteId);

      const sessoes = await tx.agendamento.findMany({
        where: { pacienteId, status: { notIn: ["CANCELADA"] } },
        orderBy: { numeroSessao: "asc" },
        include: { pacote: { select: { frequenciaSemanal: true } } },
      });

      for (const s of sessoes) {
        if (s.inicio < agora) continue;
        let novaData = new Date(s.inicio.getTime() + semanas * 7 * DIA_MS);

        if (diaAlvo !== null && horaAlvo) {
          // inicioSemanaSP é segunda 00:00 SP como instante real (03:00 UTC):
          // somar dias e ler os componentes UTC dá o dia de calendário certo.
          const semana = inicioSemanaSP(novaData);
          const diaCalendario = new Date(semana.getTime() + diaAlvo * DIA_MS);
          novaData = criarDataSP(
            diaCalendario.getUTCFullYear(),
            diaCalendario.getUTCMonth() + 1,
            diaCalendario.getUTCDate(),
            horaAlvo.h,
            horaAlvo.m
          );
        }

        if (novaData < hojeZero) {
          throw new ErroEmpurrar(
            400,
            `Operação bloqueada: sessão ${s.numeroSessao} cairia antes de hoje. Nada foi movido.`
          );
        }
        movimentos.push({
          id: s.id,
          numeroSessao: s.numeroSessao,
          novaData,
          googleEventId: s.googleEventId,
          limite: s.pacote?.frequenciaSemanal ?? 1,
        });
      }

      if (movimentos.length === 0) {
        throw new ErroEmpurrar(400, "nenhuma sessão futura para mover");
      }

      // Cadência: cada sessão movida contra as que ficam (passadas) e contra
      // as outras movidas — em ordem cronológica, com o limite do pacote de
      // cada uma (D1).
      const naoMovidas = sessoes.filter((s) => s.inicio < agora);
      const conflitos = validarCadenciaLote(
        [...movimentos]
          .sort((a, b) => a.novaData.getTime() - b.novaData.getTime())
          .map((mov) => ({ id: mov.id, novaData: mov.novaData, limite: mov.limite, rotulo: `sessão ${mov.numeroSessao}` })),
        naoMovidas
      );
      if (conflitos.length > 0 && !forcar) throw new ErroCadencia(conflitos);

      for (const mov of movimentos) {
        await tx.agendamento.update({
          where: { id: mov.id },
          data: { inicio: mov.novaData, status: "AGENDADA" },
        });
      }
      if (body.novoDia && body.novoHorario) {
        await tx.paciente.update({
          where: { id: pacienteId },
          data: { diaPreferido: body.novoDia, horarioFixo: body.novoHorario },
        });
      }
      if (conflitos.length > 0 && forcar) {
        await registrarExcecaoCadencia(tx, {
          clinicaId: usuario.clinicaId,
          usuarioId: usuario.id,
          pacienteId,
          operacao: `o empurrar de ${semanas} semana(s)`,
          motivo: forcar.motivo,
          conflitos,
        });
      }
    }, OPCOES_TRANSACAO_CADENCIA);
  } catch (err) {
    if (err instanceof ErroCadencia) return respostaCadencia(err, usuario.papel, "Não é possível empurrar (nada foi movido)");
    if (err instanceof ErroEmpurrar) return NextResponse.json({ erro: err.message }, { status: err.status });
    throw err;
  }

  // Reflete a nova data/hora no Google Calendar de cada sessão movida — via
  // outbox: CALENDAR_ATUALIZAR se a sessão já tinha evento, CALENDAR_CRIAR se
  // nunca teve (mesmo gate de POST /api/pacotes: clínica conectada, Meet só
  // quando o tipo de atendimento é online — resolvido pelo worker ao reler a
  // sessão). enfileirar() sequencial dentro do for (nunca em paralelo) pra
  // preservar a ordem relativa do loop na fila — mesmo raciocínio de
  // pacientes/[id]/adiar/route.ts. Falha na integração nunca desfaz o que já
  // foi movido no banco; googleSyncStatus vira PENDENTE (era
  // SINCRONIZADO/FALHOU síncrono antes) — mesmo espírito do achado da
  // auditoria de 2026-07-23 (sessões do paciente Jadir ficaram com a data
  // desatualizada no Google porque a falha síncrona de então era só logada).
  const clinica = await prisma.clinica.findUnique({
    where: { id: usuario.clinicaId },
    select: { googleConectado: true },
  });
  if (clinica?.googleConectado) {
    for (const mov of movimentos) {
      await prisma.agendamento.update({ where: { id: mov.id }, data: { googleSyncStatus: "PENDENTE" } });
      await enfileirar(usuario.clinicaId, mov.googleEventId ? "CALENDAR_ATUALIZAR" : "CALENDAR_CRIAR", {
        agendamentoId: mov.id,
      });
    }
  }

  const sessaoOuSessoes = movimentos.length === 1 ? "sessão" : "sessões";
  const semanaOuSemanas = semanas === 1 ? "semana" : "semanas";
  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "EMPURRAR",
    `Empurrou ${movimentos.length} ${sessaoOuSessoes} de ${paciente.nome} em ${semanas} ${semanaOuSemanas}`
  );

  return NextResponse.json({ empurradas: movimentos.length, semanas });
}
