import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma";
import { pode, type Papel } from "@/lib/permissoes";
import { formatarDataHoraSP } from "@/lib/timezone";
import type { ConflitoCadencia } from "@/lib/conflitoSemana";

type TransacaoPrisma = Prisma.TransactionClient;

export const MOTIVO_EXCECAO_MIN = 10;

// Opções das $transaction que validam cadência: o default de 5s do Prisma é
// apertado para criar um pacote de 12 sessões via pooler; 15s dá folga sem
// segurar o lock do paciente indefinidamente.
export const OPCOES_TRANSACAO_CADENCIA = { timeout: 15000, maxWait: 10000 };

export type LeituraForcarCadencia =
  | { ok: true; forcar: { motivo: string } | null }
  | { ok: false; erro: string };

// Lê `forcarCadencia: { motivo }` do body. Sem a capacidade
// furarTravaSemanal (só ADMIN) o campo é ignorado — a operação segue como se
// ele não existisse e a trava normal se aplica. Com a capacidade, o motivo é
// obrigatório (mín. MOTIVO_EXCECAO_MIN caracteres) e vale só para esta
// requisição; nada é persistido além do log.
export function lerForcarCadencia(body: unknown, papel: Papel): LeituraForcarCadencia {
  const bruto = (body as { forcarCadencia?: unknown } | null)?.forcarCadencia;
  if (bruto === undefined || bruto === null) return { ok: true, forcar: null };
  if (!pode(papel, "furarTravaSemanal")) return { ok: true, forcar: null };
  const motivo =
    typeof (bruto as { motivo?: unknown }).motivo === "string" ? (bruto as { motivo: string }).motivo.trim() : "";
  if (motivo.length < MOTIVO_EXCECAO_MIN) {
    return { ok: false, erro: `o motivo da exceção precisa ter pelo menos ${MOTIVO_EXCECAO_MIN} caracteres` };
  }
  return { ok: true, forcar: { motivo } };
}

// Serializa toda escrita que valida cadência para um mesmo paciente: lock
// transacional do Postgres (liberado sozinho no COMMIT/ROLLBACK). Precisa
// ser a primeira instrução da $transaction, antes de ler as sessões. Funciona
// no pooler (pgbouncer em modo transação) porque a transação inteira usa uma
// única conexão. $executeRaw (não $queryRaw) porque pg_advisory_xact_lock
// devolve `void`, que o $queryRaw não desserializa.
export async function travarPaciente(tx: TransacaoPrisma, pacienteId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${pacienteId}))`;
}

// Lançado dentro da $transaction para abortá-la (rollback) quando a cadência
// é violada sem exceção válida; a rota converte em 409 com respostaCadencia().
export class ErroCadencia extends Error {
  constructor(public conflitos: ConflitoCadencia[]) {
    super("cadência semanal violada");
    this.name = "ErroCadencia";
  }
}

// Resposta 409 padrão de cadência. `codigo: "CADENCIA"` é o que o front usa
// para decidir se mostra o diálogo "Forçar mesmo assim" (só quando
// podeForcar = true, i.e. ADMIN).
export function respostaCadencia(erro: ErroCadencia, papel: Papel, prefixo = "Não é possível") {
  const linhas = erro.conflitos.map((c) => c.mensagem);
  const mensagem =
    linhas.length === 1 ? `${prefixo}: ${linhas[0]}.` : `${prefixo} — conflitos de cadência:\n• ${linhas.join("\n• ")}`;
  return NextResponse.json(
    {
      erro: mensagem,
      codigo: "CADENCIA",
      podeForcar: pode(papel, "furarTravaSemanal"),
      conflitos: erro.conflitos.map((c) => ({
        id: c.id,
        data: c.novaData.toISOString(),
        motivo: c.motivo,
        mensagem: c.mensagem,
      })),
    },
    { status: 409 }
  );
}

// Log da exceção, gravado com o `tx` da própria escrita: se o log falhar, a
// escrita forçada é desfeita junto (diferente de registrarLog, que engole
// erro de propósito).
export async function registrarExcecaoCadencia(
  tx: TransacaoPrisma,
  dados: {
    clinicaId: string;
    usuarioId: string;
    pacienteId: string;
    operacao: string;
    motivo: string;
    conflitos: ConflitoCadencia[];
  }
): Promise<void> {
  const sessoes = dados.conflitos
    .map((c) => `${c.id} → ${formatarDataHoraSP(c.novaData)} (${c.motivo})`)
    .join("; ");
  await tx.logAuditoria.create({
    data: {
      clinicaId: dados.clinicaId,
      usuarioId: dados.usuarioId,
      acao: "EXCECAO_CADENCIA",
      detalhe: `Forçou ${dados.operacao} fora da cadência semanal — paciente ${dados.pacienteId} — motivo: ${dados.motivo} — sessões: ${sessoes}`,
    },
  });
}
