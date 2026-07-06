import { statusLabel } from "@/lib/labels";

// Mesmo critério do painel (STATUS_TRAVADOS): sessão já consumida não pode
// receber uma nova ação, seja individual ou em lote.
export const STATUS_CONSUMIDOS_LOTE = ["REALIZADA", "NAO_REALIZADA", "CANCELADA"];

export const STATUS_LOTE_VALIDOS = ["REALIZADA", "NAO_REALIZADA", "CANCELADA"] as const;
export type StatusLoteValido = (typeof STATUS_LOTE_VALIDOS)[number];

export function statusLoteValido(status: unknown): status is StatusLoteValido {
  return typeof status === "string" && (STATUS_LOTE_VALIDOS as readonly string[]).includes(status);
}

interface SessaoParaFiltro {
  id: string;
  status: string;
  paciente: { clinicaId: string };
}

// Sessões elegíveis para a ação em lote: pertencem à clínica do usuário
// logado e ainda não foram consumidas. As demais são "puladas" — nunca
// barram a operação inteira.
export function filtrarSessoesElegiveis<T extends SessaoParaFiltro>(sessoes: T[], clinicaId: string): T[] {
  return sessoes.filter((s) => s.paciente.clinicaId === clinicaId && !STATUS_CONSUMIDOS_LOTE.includes(s.status));
}

export function resolverNomePaciente(nomes: string[]): string {
  const unicos = Array.from(new Set(nomes));
  return unicos.length === 1 ? unicos[0] : `${unicos.length} pacientes`;
}

// Texto do log de auditoria agregado da operação em lote.
export function montarDetalheLote(
  status: StatusLoteValido,
  quantidade: number,
  nomePaciente: string,
  motivo: string
): string {
  const sessaoOuSessoes = quantidade === 1 ? "sessão" : "sessões";
  if (status === "CANCELADA") {
    return `Cancelou ${quantidade} ${sessaoOuSessoes} de ${nomePaciente} — motivo: ${motivo}`;
  }
  return `Marcou ${quantidade} ${sessaoOuSessoes} de ${nomePaciente} como ${statusLabel(status)}`;
}
