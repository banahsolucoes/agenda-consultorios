import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { obterClinicaECalendar } from "@/lib/google";
import { registrarLog } from "@/lib/auditoria";
import { pareceUrl } from "@/lib/validacao";
import { soDigitos } from "@/lib/importacao";
import { pode } from "@/lib/permissoes";
import { sincronizarTarefaRenovacao } from "@/lib/tarefas";

const CAMPOS_EDITAVEIS = [
  "nome",
  "telefone",
  "email",
  "cpf",
  "rg",
  "logradouro",
  "numero",
  "complemento",
  "bairro",
  "cidade",
  "estado",
  "cep",
  "quemIndicou",
  "dataNascimento",
  "estadoCivil",
  "nacionalidade",
  "profissao",
  "instagram",
  "pastaDriveUrl",
  "anamnese",
  "origemCadastro",
  "diaPreferido",
  "horarioFixo",
  "tipoSessaoId",
] as const;

const DIAS_VALIDOS = ["SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA", "SABADO", "DOMINGO"];
const ORIGENS_VALIDAS = ["MANUAL", "FORMS"];
const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const STATUS_GERAL_VALIDOS = ["ATIVO", "CANCELADO", "FINALIZADO"];

// nome é obrigatório (String, não-nulo no schema) — nunca pode virar null.
// origemCadastro também é obrigatório (enum com default) — mesmo raciocínio.
// Todos os demais campos de CAMPOS_EDITAVEIS são colunas opcionais (String?)
// e seguem o contrato de três estados abaixo.
const CAMPOS_NAO_NULAVEIS = new Set(["nome", "origemCadastro"]);

// Contrato de três estados pro PATCH (2026-08-06, corrige o bug de salvar
// paciente com diaPreferido/horarioFixo nulos — ver ARCHITECTURE.md):
//   chave ausente no body  -> não altera o campo
//   null                   -> limpa o campo (grava null)
//   ""                     -> tratado como null (string vazia nunca é um
//                              valor válido — evita o front mandar "" sem
//                              querer e ficar destoando de quem manda null)
//   string não-vazia       -> valida normalmente
function normalizarVazio(valor: unknown): unknown {
  return valor === "" ? null : valor;
}

// GET /api/pacientes/[id] — retorna o paciente da clínica logada
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  // clinicaId entra no select só para a checagem de tenant abaixo — nunca
  // sai na resposta (retirado antes do NextResponse.json). finalizadoEm não
  // é lido em nenhum lugar do front (painel/page.tsx, AnamneseModal.tsx,
  // AnamneseEditor.tsx, AnexosPaciente.tsx) — fora do select.
  const paciente = await prisma.paciente.findUnique({
    where: { id },
    select: {
      id: true,
      clinicaId: true,
      nome: true,
      telefone: true,
      email: true,
      cpf: true,
      rg: true,
      logradouro: true,
      numero: true,
      complemento: true,
      bairro: true,
      cidade: true,
      estado: true,
      cep: true,
      quemIndicou: true,
      dataNascimento: true,
      estadoCivil: true,
      nacionalidade: true,
      profissao: true,
      instagram: true,
      pastaDriveUrl: true,
      anamnese: true,
      origemCadastro: true,
      diaPreferido: true,
      horarioFixo: true,
      tipoSessaoId: true,
      statusGeral: true,
    },
  });
  if (!paciente || paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "paciente não encontrado" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { clinicaId: _clinicaId, ...pacienteSemClinicaId } = paciente;
  return NextResponse.json(pacienteSemClinicaId);
}

// PATCH /api/pacientes/[id] — edita o cadastro de um paciente da clínica logada
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const paciente = await prisma.paciente.findUnique({ where: { id } });
  if (!paciente || paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "paciente não encontrado" }, { status: 404 });
  }

  const body = await req.json();

  // nome/origemCadastro são obrigatórios — "" nunca vira null pra eles,
  // rejeitado direto como valor inválido.
  if (body.nome !== undefined && (typeof body.nome !== "string" || body.nome.trim() === "")) {
    return NextResponse.json({ erro: "nome não pode ser vazio" }, { status: 400 });
  }
  if (body.origemCadastro !== undefined && !ORIGENS_VALIDAS.includes(body.origemCadastro)) {
    return NextResponse.json({ erro: "origemCadastro inválida" }, { status: 400 });
  }

  // Demais campos: "" normaliza pra null antes de validar — null (explícito
  // ou vindo de "") sempre significa "limpar o campo", nunca dispara
  // validação de formato/existência.
  const diaPreferido = body.diaPreferido !== undefined ? normalizarVazio(body.diaPreferido) : undefined;
  if (diaPreferido !== undefined && diaPreferido !== null && !DIAS_VALIDOS.includes(diaPreferido as string)) {
    return NextResponse.json({ erro: "diaPreferido inválido" }, { status: 400 });
  }
  const horarioFixo = body.horarioFixo !== undefined ? normalizarVazio(body.horarioFixo) : undefined;
  if (horarioFixo !== undefined && horarioFixo !== null && !HORA_REGEX.test(horarioFixo as string)) {
    return NextResponse.json({ erro: "horarioFixo deve estar no formato HH:MM" }, { status: 400 });
  }
  const tipoSessaoId = body.tipoSessaoId !== undefined ? normalizarVazio(body.tipoSessaoId) : undefined;
  if (tipoSessaoId !== undefined && tipoSessaoId !== null) {
    const tipoSessao = await prisma.tipoSessao.findUnique({ where: { id: tipoSessaoId as string } });
    if (!tipoSessao || tipoSessao.clinicaId !== usuario.clinicaId) {
      return NextResponse.json({ erro: "tipoSessaoId inválido" }, { status: 400 });
    }
  }
  const pastaDriveUrl = body.pastaDriveUrl !== undefined ? normalizarVazio(body.pastaDriveUrl) : undefined;
  if (pastaDriveUrl !== undefined && pastaDriveUrl !== null && !pareceUrl(pastaDriveUrl as string)) {
    return NextResponse.json({ erro: "pastaDriveUrl deve ser uma URL válida" }, { status: 400 });
  }
  if (body.statusGeral !== undefined && !STATUS_GERAL_VALIDOS.includes(body.statusGeral)) {
    return NextResponse.json({ erro: "statusGeral inválido" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  for (const campo of CAMPOS_EDITAVEIS) {
    if (body[campo] === undefined) continue;
    data[campo] = CAMPOS_NAO_NULAVEIS.has(campo) ? body[campo] : normalizarVazio(body[campo]);
  }
  // Normaliza pra só dígitos antes de gravar — consistência com a
  // constraint @@unique([clinicaId, cpf]). Sobrescreve o valor já
  // normalizado acima (mesmo resultado pra "" -> null, mas também limpa
  // pontuação de um CPF preenchido).
  if (body.cpf !== undefined) {
    data.cpf = soDigitos(String(body.cpf ?? "")) || null;
  }

  // Troca manual de status é reversível e não mexe em sessões: só atualiza o
  // rótulo e o carimbo de finalização (limpo quando sai de FINALIZADO).
  const statusAnterior = paciente.statusGeral;
  const statusAlterado = body.statusGeral !== undefined && body.statusGeral !== statusAnterior;
  if (statusAlterado) {
    data.statusGeral = body.statusGeral;
    data.finalizadoEm = body.statusGeral === "FINALIZADO" ? new Date() : null;
  }

  let atualizado;
  let tarefa: { tarefaCriada: boolean; tarefasConcluidas: number } = { tarefaCriada: false, tarefasConcluidas: 0 };
  try {
    if (statusAlterado) {
      const resultado = await prisma.$transaction(async (tx) => {
        const atualizado = await tx.paciente.update({ where: { id }, data });
        const tarefa = await sincronizarTarefaRenovacao(
          tx,
          atualizado,
          atualizado.statusGeral as "ATIVO" | "FINALIZADO" | "CANCELADO",
          usuario.id
        );
        return { atualizado, tarefa };
      });
      atualizado = resultado.atualizado;
      tarefa = resultado.tarefa;
    } else {
      atualizado = await prisma.paciente.update({ where: { id }, data });
    }
  } catch (err) {
    const codigo = (err as { code?: string } | null)?.code;
    if (codigo === "P2002") {
      return NextResponse.json({ erro: "CPF já cadastrado nesta clínica" }, { status: 409 });
    }
    throw err;
  }

  const camposAlterados = Object.keys(data).filter((campo) =>
    (CAMPOS_EDITAVEIS as readonly string[]).includes(campo)
  );
  if (camposAlterados.length > 0) {
    await registrarLog(
      usuario.clinicaId,
      usuario.id,
      "EDITAR_PACIENTE",
      `Editou o paciente ${atualizado.nome} (campos: ${camposAlterados.join(", ")})`
    );
  }
  if (statusAlterado) {
    await registrarLog(
      usuario.clinicaId,
      usuario.id,
      "ALTERAR_STATUS_PACIENTE",
      `Alterou o status de ${atualizado.nome} de ${statusAnterior} para ${atualizado.statusGeral}`
    );
    if (tarefa.tarefaCriada) {
      await registrarLog(
        usuario.clinicaId,
        usuario.id,
        "CRIAR_TAREFA_RENOVACAO",
        `Tarefa de renovação criada para ${atualizado.nome}`
      );
    }
    if (tarefa.tarefasConcluidas > 0) {
      await registrarLog(
        usuario.clinicaId,
        usuario.id,
        "CONCLUIR_TAREFA_RENOVACAO",
        `Tarefa de renovação de ${atualizado.nome} concluída (status alterado manualmente)`
      );
    }
  }

  return NextResponse.json(atualizado);
}

// DELETE /api/pacientes/[id] — exclui definitivamente o paciente e seu
// histórico (pacotes, sessões, consentimentos) da clínica logada. Ação
// irreversível — o operador já confirmou explicitamente na UI.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(usuario.papel, "excluirPaciente")) {
    return NextResponse.json({ erro: "sem permissão para esta ação" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const paciente = await prisma.paciente.findUnique({ where: { id } });
  if (!paciente || paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "paciente não encontrado" }, { status: 404 });
  }

  // Remove os eventos do Google Calendar das sessões futuras, melhor esforço
  // — falha na integração nunca impede a exclusão do paciente.
  const sessoesFuturasComEvento = await prisma.agendamento.findMany({
    where: { pacienteId: id, googleEventId: { not: null }, inicio: { gte: new Date() } },
  });
  if (sessoesFuturasComEvento.length > 0) {
    const google = await obterClinicaECalendar(usuario.clinicaId);
    if (google) {
      for (const s of sessoesFuturasComEvento) {
        await google.calendar.events
          .delete({
            calendarId: s.googleCalendarId ?? google.clinica.googleCalendarId ?? "primary",
            eventId: s.googleEventId!,
          })
          .catch((err) => console.error("Falha ao remover evento do Google Calendar:", err));
      }
    }
  }

  await prisma.$transaction([
    prisma.agendamento.deleteMany({ where: { pacienteId: id } }),
    prisma.consentimento.deleteMany({ where: { pacienteId: id } }),
    prisma.pacote.deleteMany({ where: { pacienteId: id } }),
    prisma.paciente.delete({ where: { id } }),
  ]);

  await registrarLog(usuario.clinicaId, usuario.id, "EXCLUIR_PACIENTE", `Excluiu o paciente ${paciente.nome}`);

  return NextResponse.json({ ok: true });
}
