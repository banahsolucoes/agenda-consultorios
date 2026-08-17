// Operação pontual, escopo restrito ao agendamento 04f3c35e-b89c-4347-92ca-9077b57d1259.
// O registro no banco já está correto/ativo; só o evento do Google Calendar
// sumiu (provável apagamento durante um arquivamento anterior). Este script:
//   1. Faz SELECT e reporta o estado atual (nenhuma escrita ainda).
//   2. Se já houver googleEventId, confirma no Google se o evento realmente
//      não existe mais antes de fazer qualquer coisa — nunca duplica.
//   3. Recria o evento chamando criarEventoGoogleMeet() de src/lib/google.ts
//      (a MESMA função usada em POST /api/pacotes na criação normal) via
//      jiti, para não reimplementar a chamada à API do Google fora da camada
//      de serviço. O título usa formatarTituloAgendamento() de blocoAgenda.ts.
//   4. Grava googleEventId/googleCalendarId/linkMeet/googleSyncStatus.
//
// Conecta via DIRECT_URL (porta 5432), nunca o pooler — mesma regra das migrations.
// Uso: node scripts/_recriar-evento-google-04f3c35e.mjs

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

if (!process.env.DIRECT_URL) {
  console.error("DIRECT_URL não definida no ambiente.");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });
const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": path.resolve(__dirname, "../src") },
});

const AGENDAMENTO_ID = "04f3c35e-b89c-4347-92ca-9077b57d1259";

async function main() {
  const { obterCalendarDaClinica, criarEventoGoogleMeet } = await jiti.import("../src/lib/google.ts");
  const { formatarTituloAgendamento } = await jiti.import("../src/lib/blocoAgenda.ts");

  console.log("=== 1. Estado atual do agendamento (antes de qualquer escrita) ===");
  const sessao = await prisma.agendamento.findUnique({
    where: { id: AGENDAMENTO_ID },
    include: { paciente: true, tipoSessao: true },
  });
  if (!sessao) {
    console.error("Agendamento não encontrado — abortando.");
    process.exit(1);
  }
  console.log("status:", sessao.status, "| arquivada:", sessao.arquivada);
  console.log("googleEventId:", sessao.googleEventId ?? "(vazio)");
  console.log("googleCalendarId:", sessao.googleCalendarId ?? "(vazio)");
  console.log("googleSyncStatus:", sessao.googleSyncStatus);
  console.log("linkMeet:", sessao.linkMeet ?? "(vazio)");
  console.log(
    "tipoSessao:", sessao.tipoSessao?.nome, "| ehAtendimentoUnico:", sessao.tipoSessao?.ehAtendimentoUnico,
    "| ehOnline:", sessao.tipoSessao?.ehOnline
  );
  console.log("inicio:", sessao.inicio.toISOString(), "| duracaoMin:", sessao.duracaoMin);
  console.log("clinicaId:", sessao.paciente.clinicaId, "| paciente:", sessao.paciente.nome);

  const clinica = await prisma.clinica.findUnique({ where: { id: sessao.paciente.clinicaId } });
  if (!clinica?.googleConectado) {
    console.error("Clínica sem Google conectado — abortando, nada a fazer.");
    process.exit(1);
  }
  const calendar = await obterCalendarDaClinica(clinica).catch((err) => {
    console.error("Falha ao obter client do Google Calendar:", err.message ?? err);
    return null;
  });
  if (!calendar) {
    console.error("Não foi possível obter client do Google Calendar — abortando.");
    process.exit(1);
  }

  const calendarIdDestino =
    sessao.googleCalendarId ?? sessao.tipoSessao?.googleCalendarId ?? clinica.googleCalendarId ?? "primary";

  console.log("\n=== 2. Verificação de duplicidade ===");
  if (sessao.googleEventId) {
    try {
      const evento = await calendar.events.get({ calendarId: calendarIdDestino, eventId: sessao.googleEventId });
      if (evento.data.status !== "cancelled") {
        console.log("O evento AINDA EXISTE no Google (status:", evento.data.status, ") — parando, não vou duplicar.");
        console.log("googleEventId existente:", sessao.googleEventId);
        return;
      }
      console.log("googleEventId preenchido, mas o evento está com status 'cancelled' no Google — pode recriar.");
    } catch (err) {
      const status = err?.response?.status ?? err?.code;
      if (status === 404 || status === 410) {
        console.log("googleEventId preenchido, mas o evento não existe mais no Google (", status, ") — pode recriar.");
      } else {
        console.error("Falha inesperada ao checar o evento existente — abortando por segurança:", err.message ?? err);
        process.exit(1);
      }
    }
  } else {
    console.log("googleEventId vazio — nenhuma checagem de duplicidade necessária.");
  }

  console.log("\n=== 3. Recriando o evento via criarEventoGoogleMeet() (mesma função da criação normal) ===");
  const titulo = formatarTituloAgendamento({
    nomePaciente: sessao.paciente.nome,
    tipoSessaoNome: sessao.tipoSessao?.nome ?? null,
    ehAtendimentoUnico: sessao.tipoSessao?.ehAtendimentoUnico ?? false,
    numeroSessao: sessao.numeroSessao,
    totalPacote: sessao.totalPacote,
  });
  const comMeet = sessao.tipoSessao?.ehOnline ?? false;
  console.log("Título:", titulo, "| comMeet:", comMeet, "| calendarId destino:", calendarIdDestino);

  const dadosGoogle = await criarEventoGoogleMeet(
    calendar,
    calendarIdDestino,
    { titulo, inicio: sessao.inicio, duracaoMin: sessao.duracaoMin, cor: sessao.tipoSessao?.cor ?? null },
    comMeet,
    clinica.id
  );

  if (!dadosGoogle.googleEventId) {
    console.error("criarEventoGoogleMeet não retornou googleEventId — falha na criação. Gravando FALHOU e parando.");
    await prisma.agendamento.update({
      where: { id: AGENDAMENTO_ID },
      data: { googleSyncStatus: "FALHOU" },
    });
    process.exit(1);
  }

  console.log("\n=== 4. Gravando resultado no banco ===");
  const atualizado = await prisma.agendamento.update({
    where: { id: AGENDAMENTO_ID },
    data: {
      googleEventId: dadosGoogle.googleEventId,
      googleCalendarId: dadosGoogle.googleCalendarId ?? calendarIdDestino,
      linkMeet: dadosGoogle.linkMeet,
      googleSyncStatus: "SINCRONIZADO",
    },
  });

  console.log("\n=== 5. Relatório final ===");
  console.log("googleEventId gravado:", atualizado.googleEventId);
  console.log("Calendário de destino:", atualizado.googleCalendarId);
  console.log("Título do evento:", titulo);
  console.log("Link do Meet:", atualizado.linkMeet ?? "(nenhum — sessão presencial ou Meet não gerado)");
  if (comMeet && !atualizado.linkMeet) {
    console.warn("ATENÇÃO: sessão online mas nenhum link de Meet foi retornado/persistido.");
  }
}

main()
  .catch((err) => {
    console.error("Falha no script:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
