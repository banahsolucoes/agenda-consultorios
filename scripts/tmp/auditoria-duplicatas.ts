// AUDITORIA SOMENTE LEITURA (2026-11-02) — duplicatas e anomalias nas sessões
// futuras da clínica pamela-rachid. Só SELECT (Prisma findMany/$queryRaw).
// Nenhuma chamada ao Google, nenhuma escrita, nenhum enfileiramento.
//
// Definições:
//  - "ativa" = status AGENDADA ou REAGENDADA e arquivada = false
//  - "futura" = inicio >= agora
//  - telefone impresso mascarado (só 4 últimos dígitos) — regra de PII do §9
//
// Uso: npx tsx scripts/tmp/auditoria-duplicatas.ts
import "dotenv/config";
import { prisma } from "@/lib/prisma";

const SLUG = "pamela-rachid";
const ATIVOS = ["AGENDADA", "REAGENDADA"] as const;

const fmtSP = (d: Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit",
        year: "numeric", hour: "2-digit", minute: "2-digit",
      }).format(d)
    : "-";
const diaSP = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const fmtUTC = (d: Date | null | undefined) => (d ? d.toISOString().replace(".000Z", "Z") : "-");
const normNome = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const normTel = (s: string | null) => {
  if (!s) return null;
  let d = s.replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  return d.length >= 10 ? d : null;
};
const mascTel = (s: string | null) => (s ? `***${s.replace(/\D/g, "").slice(-4)}` : "-");
const ehAtiva = (s: { status: string; arquivada: boolean }) => (ATIVOS as readonly string[]).includes(s.status) && !s.arquivada;

function tabela(titulo: string, cab: string[], linhas: (string | number)[][]) {
  console.log(`\n### ${titulo} (${linhas.length})`);
  if (!linhas.length) {
    console.log("(nenhum)");
    return;
  }
  console.log(`| ${cab.join(" | ")} |`);
  console.log(`|${cab.map(() => "---").join("|")}|`);
  for (const l of linhas) console.log(`| ${l.map((c) => String(c).replace(/\|/g, "/")).join(" | ")} |`);
}

async function main() {
  const agora = new Date();
  const clinica = await prisma.clinica.findUniqueOrThrow({ where: { slug: SLUG } });

  const sessoes = await prisma.agendamento.findMany({
    where: { clinicaId: clinica.id },
    include: {
      paciente: { select: { id: true, nome: true } },
      aluno: { select: { nomeCompleto: true } },
      tipoSessao: { select: { nome: true, ehOnline: true } },
    },
    orderBy: { inicio: "asc" },
  });
  const futurasAtivas = sessoes.filter((s) => s.inicio >= agora && ehAtiva(s));
  const nomeDe = (s: (typeof sessoes)[number]) => s.paciente?.nome ?? (s.aluno ? `[mentorado] ${s.aluno.nomeCompleto}` : "-");

  // Quem criou: log CRIAR_ATENDIMENTO (ou outro) da mesma clínica até 10s depois do criadoEm da sessão
  const logs = await prisma.logAuditoria.findMany({
    where: { clinicaId: clinica.id },
    include: { usuario: { select: { nome: true } } },
    orderBy: { criadoEm: "asc" },
  });
  const quemCriou = (s: (typeof sessoes)[number]) => {
    const t = s.criadoEm.getTime();
    const nome = s.paciente?.nome;
    const l = logs.find(
      (l) =>
        l.criadoEm.getTime() >= t - 1000 &&
        l.criadoEm.getTime() <= t + 10_000 &&
        (!nome || (l.detalhe ?? "").includes(nome))
    );
    return l ? `${l.usuario?.nome ?? "(sistema)"} [${l.acao}]` : "(sem log)";
  };

  // ---------- 1. Saldo por paciente ----------
  const pacotes = await prisma.pacote.findMany({
    where: { paciente: { clinicaId: clinica.id } },
    include: { paciente: { select: { nome: true } } },
  });
  const t1: (string | number)[][] = [];
  const t1Flag: (string | number)[][] = [];
  const porPaciente = new Map<string, typeof sessoes>();
  for (const s of sessoes) {
    if (!s.pacienteId) continue;
    if (!porPaciente.has(s.pacienteId)) porPaciente.set(s.pacienteId, []);
    porPaciente.get(s.pacienteId)!.push(s);
  }
  for (const [pid, lista] of porPaciente) {
    const fut = lista.filter((s) => s.inicio >= agora && ehAtiva(s));
    const ativos = pacotes.filter((p) => p.pacienteId === pid && p.status === "ATIVO");
    if (!fut.length && !ativos.length) continue;
    for (const pk of ativos.length ? ativos : [null]) {
      const doPk = pk ? lista.filter((s) => s.pacoteId === pk.id) : fut;
      const realizadas = doPk.filter((s) => s.status === "REALIZADA").length;
      const naoReal = doPk.filter((s) => s.status === "NAO_REALIZADA").length;
      const futPk = doPk.filter((s) => s.inicio >= agora && ehAtiva(s)).length;
      const passadasPend = doPk.filter((s) => s.inicio < agora && ehAtiva(s)).length;
      const canceladas = doPk.filter((s) => s.status === "CANCELADA").length;
      const linhasPk = doPk.length;
      const total = pk?.totalSessoes ?? "-";
      const excede = pk ? realizadas + naoReal + futPk + passadasPend > pk.totalSessoes : false;
      const linha = [
        lista[0].paciente!.nome, fut.length, pk ? `${pk.id.slice(0, 8)} ${pk.tipo}` : "(sem pacote ativo)", total,
        realizadas, naoReal, passadasPend, futPk, canceladas, linhasPk, excede ? "⚠ EXCEDE" : "",
      ];
      t1.push(linha);
      if (excede) t1Flag.push(linha);
    }
  }
  t1.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const cab1 = ["paciente", "futuras ativas (todas)", "pacote ativo", "total", "realizadas", "não realizadas", "passadas sem baixa", "futuras no pacote", "canceladas", "linhas no pacote", "flag"];

  // ---------- 2. Duplicatas do mesmo paciente ----------
  const t2: (string | number)[][] = [];
  let paresDup = 0;
  const porPacFut = new Map<string, typeof futurasAtivas>();
  for (const s of futurasAtivas) {
    const k = s.pacienteId ?? `aluno:${s.alunoId}`;
    if (!porPacFut.has(k)) porPacFut.set(k, []);
    porPacFut.get(k)!.push(s);
  }
  for (const lista of porPacFut.values()) {
    const marcados = new Set<string>();
    for (let i = 0; i < lista.length; i++)
      for (let j = i + 1; j < lista.length; j++) {
        const a = lista[i], b = lista[j];
        const mesmoDia = diaSP(a.inicio) === diaSP(b.inicio);
        const menos1h = Math.abs(b.inicio.getTime() - a.inicio.getTime()) < 3600_000;
        if (mesmoDia || menos1h) {
          paresDup++;
          marcados.add(a.id).add(b.id);
          void (mesmoDia && menos1h);
        }
      }
    for (const s of lista.filter((x) => marcados.has(x.id)))
      t2.push([nomeDe(s), s.id, `${s.numeroSessao ?? "-"}/${s.totalPacote ?? "-"}`, fmtSP(s.inicio), s.tipoSessao?.nome ?? "-", s.status, s.pacoteId?.slice(0, 8) ?? "-", fmtUTC(s.criadoEm), quemCriou(s)]);
  }

  // ---------- 3. Conflitos entre pacientes diferentes ----------
  const t3: (string | number)[][] = [];
  let conflitosMesmaMod = 0, conflitosCruzados = 0;
  const fim = (s: (typeof sessoes)[number]) => s.inicio.getTime() + s.duracaoMin * 60_000;
  for (let i = 0; i < futurasAtivas.length; i++)
    for (let j = i + 1; j < futurasAtivas.length; j++) {
      const a = futurasAtivas[i], b = futurasAtivas[j];
      if (b.inicio.getTime() >= fim(a)) break; // ordenado por inicio
      const pa = a.pacienteId ?? a.alunoId, pb = b.pacienteId ?? b.alunoId;
      if (pa === pb) continue;
      const mesmaMod = (a.tipoSessao?.ehOnline ?? null) === (b.tipoSessao?.ehOnline ?? null);
      if (mesmaMod) conflitosMesmaMod++; else conflitosCruzados++;
      t3.push([
        mesmaMod ? (a.tipoSessao?.ehOnline ? "online×online" : "presencial×presencial") : "cruzada (online×presencial)",
        `${nomeDe(a)} ${a.numeroSessao ?? ""}/${a.totalPacote ?? ""}`, `${fmtSP(a.inicio)} (${a.duracaoMin}min) ${a.tipoSessao?.nome ?? "-"}`,
        `${nomeDe(b)} ${b.numeroSessao ?? ""}/${b.totalPacote ?? ""}`, `${fmtSP(b.inicio)} (${b.duracaoMin}min) ${b.tipoSessao?.nome ?? "-"}`,
        `${Math.round((Math.min(fim(a), fim(b)) - b.inicio.getTime()) / 60000)}min`, `${a.id.slice(0, 8)} / ${b.id.slice(0, 8)}`,
      ]);
    }
  t3.sort((x, y) => (String(x[0]).startsWith("cruzada") ? 1 : 0) - (String(y[0]).startsWith("cruzada") ? 1 : 0));

  // ---------- 4. Pacientes duplicados ----------
  const pacientes = await prisma.paciente.findMany({
    where: { clinicaId: clinica.id },
    select: { id: true, nome: true, telefone: true, cpf: true, statusGeral: true, criadoEm: true, origemCadastro: true },
  });
  const grupos = new Map<string, { motivo: string; ps: typeof pacientes }>();
  const add = (k: string, motivo: string, p: (typeof pacientes)[number]) => {
    if (!grupos.has(k)) grupos.set(k, { motivo, ps: [] });
    grupos.get(k)!.ps.push(p);
  };
  for (const p of pacientes) {
    add(`n:${normNome(p.nome)}`, "nome", p);
    const t = normTel(p.telefone);
    if (t) add(`t:${t}`, "telefone", p);
  }
  const t4: (string | number)[][] = [];
  let gruposDup = 0;
  const contaSess = new Map<string, number>();
  for (const s of sessoes) if (s.pacienteId) contaSess.set(s.pacienteId, (contaSess.get(s.pacienteId) ?? 0) + 1);
  for (const [k, g] of grupos) {
    if (g.ps.length < 2) continue;
    gruposDup++;
    for (const p of g.ps)
      t4.push([`${g.motivo}: ${g.motivo === "nome" ? k.slice(2) : mascTel(k.slice(2))}`, p.nome, p.id, mascTel(p.telefone), p.cpf ? "sim" : "não", p.statusGeral, p.origemCadastro, fmtUTC(p.criadoEm), contaSess.get(p.id) ?? 0]);
  }

  // ---------- 5. Sessões muito movidas (30 dias) ----------
  const desde = new Date(agora.getTime() - 30 * 86400_000);
  const fila = await prisma.$queryRaw<Array<{ ag: string; n: bigint }>>`
    SELECT payload->>'agendamentoId' AS ag, count(*) AS n FROM "SincronizacaoPendente"
    WHERE "clinicaId" = ${clinica.id} AND tipo = 'CALENDAR_ATUALIZAR' AND "createdAt" >= ${desde}
    GROUP BY 1`;
  const filaPor = new Map(fila.map((f) => [f.ag, Number(f.n)]));
  const logsEdit = logs.filter((l) => l.acao === "EDITAR_SESSAO" && l.criadoEm >= desde);
  const t5: (string | number)[][] = [];
  for (const s of futurasAtivas) {
    if (!s.paciente || s.numeroSessao == null) {
      const nf = filaPor.get(s.id) ?? 0;
      if (nf > 5) t5.push([nomeDe(s), `${s.numeroSessao ?? "-"}/${s.totalPacote ?? "-"}`, fmtSP(s.inicio), "-", nf, s.id]);
      continue;
    }
    const prefixo = `Editou a sessão ${s.numeroSessao} de ${s.paciente.nome} `;
    const nLog = logsEdit.filter((l) => (l.detalhe ?? "").startsWith(prefixo)).length;
    const nFila = filaPor.get(s.id) ?? 0;
    if (nLog > 5 || nFila > 5) t5.push([s.paciente.nome, `${s.numeroSessao}/${s.totalPacote}`, fmtSP(s.inicio), nLog, nFila, s.id]);
  }
  t5.sort((a, b) => Math.max(Number(b[3]) || 0, Number(b[4])) - Math.max(Number(a[3]) || 0, Number(a[4])));

  // ---------- 6. Pacotes ativos sem sessão futura ----------
  const t6: (string | number)[][] = [];
  for (const pk of pacotes.filter((p) => p.status === "ATIVO")) {
    const doPk = sessoes.filter((s) => s.pacoteId === pk.id);
    if (doPk.some((s) => s.inicio >= agora && ehAtiva(s))) continue;
    const ultima = doPk.filter((s) => s.status !== "CANCELADA").at(-1);
    const cont = (st: string) => doPk.filter((s) => s.status === st).length;
    const passadasPend = doPk.filter((s) => s.inicio < agora && ehAtiva(s)).length;
    t6.push([pk.paciente.nome, `${pk.id.slice(0, 8)} ${pk.tipo}`, pk.totalSessoes, cont("REALIZADA"), cont("NAO_REALIZADA"), passadasPend, cont("CANCELADA"), ultima ? `${fmtSP(ultima.inicio)} (${ultima.status})` : "-", fmtUTC(pk.criadoEm)]);
  }

  // ---------- Saída ----------
  console.log(`# Auditoria de duplicatas/anomalias — ${SLUG} — gerado em ${fmtUTC(agora)}`);
  console.log(`\n## Resumo`);
  console.log(`- Sessões futuras ativas: ${futurasAtivas.length} (pacientes distintos: ${new Set(futurasAtivas.map((s) => s.pacienteId ?? s.alunoId)).size})`);
  console.log(`- 1. Pacientes/pacotes com mais sessões que o total: ${t1Flag.length}`);
  console.log(`- 2. Pares duplicados do mesmo paciente (mesmo dia ou <1h): ${paresDup} (${t2.length} sessões)`);
  console.log(`- 3. Sobreposições entre pacientes diferentes: ${conflitosMesmaMod} na mesma modalidade + ${conflitosCruzados} cruzadas`);
  console.log(`- 4. Grupos de pacientes possivelmente duplicados: ${gruposDup}`);
  console.log(`- 5. Sessões futuras com >5 alterações em 30 dias: ${t5.length}`);
  console.log(`- 6. Pacotes ativos sem sessão futura: ${t6.length}`);

  tabela("1. Saldo por paciente — só os que EXCEDEM", cab1, t1Flag);
  tabela("1. Saldo por paciente — completo", cab1, t1);
  tabela("2. Duplicatas do mesmo paciente", ["paciente", "id", "n/total", "data SP", "tipo", "status", "pacote", "criadoEm (UTC)", "quem criou"], t2);
  tabela("3. Sobreposições entre pacientes diferentes", ["modalidade", "sessão A", "horário A", "sessão B", "horário B", "sobreposição", "ids"], t3);
  tabela("4. Pacientes possivelmente duplicados", ["chave", "nome", "id", "telefone", "cpf?", "status", "origem", "criadoEm", "nº sessões"], t4);
  tabela("5. Sessões muito movidas (30 dias)", ["paciente", "n/total", "data SP atual", "EDITAR_SESSAO no log", "CALENDAR_ATUALIZAR na fila", "id"], t5);
  tabela("6. Pacotes ativos sem sessão futura", ["paciente", "pacote", "total", "realizadas", "não realizadas", "passadas sem baixa", "canceladas", "última sessão", "pacote criadoEm"], t6);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
