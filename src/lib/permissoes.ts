// src/lib/permissoes.ts
/**
 * Capacidades (permissões) do sistema.
 * Cada papel tem um conjunto de capacidades permitidas.
 */
export type Capacidade =
  | "gerirPacientes"
  | "excluirPaciente"
  | "operarAgenda"
  | "verConfiguracoes"
  | "editarConfiguracoes"
  | "gerirIntegracoes"
  | "gerirTiposAtendimento"
  | "gerirIdentidadeVisual"
  | "gerirUsuarios"
  | "criarClinica"
  | "verLog"
  | "gerirBilling"
  | "atenderWhatsapp";

/**
 * Papel do usuário no sistema.
 * Deve coincidir com o enum Papel do Prisma.
 */
export type Papel = "ADMIN" | "PROFISSIONAL" | "OPERADOR";

/**
 * Mapeamento de papéis para capacidades permitidas.
 * ADMIN: todas as capacidades.
 * PROFISSIONAL: tudo do OPERADOR + excluirPaciente, editarConfiguracoes,
 * gerirIdentidadeVisual, gerirIntegracoes = true; gerirUsuarios, criarClinica,
 * verLog, gerirBilling = false.
 * OPERADOR: gerirPacientes, operarAgenda, gerirTiposAtendimento = true; restante false.
 */
export const capacidadesPorPapel: Record<Papel, Record<Capacidade, boolean>> = {
  ADMIN: {
    gerirPacientes: true,
    excluirPaciente: true,
    operarAgenda: true,
    verConfiguracoes: true,
    editarConfiguracoes: true,
    gerirIntegracoes: true,
    gerirTiposAtendimento: true,
    gerirIdentidadeVisual: true,
    gerirUsuarios: true,
    criarClinica: true,
    verLog: true,
    gerirBilling: true,
    atenderWhatsapp: true,
  },
  PROFISSIONAL: {
    gerirPacientes: true,
    excluirPaciente: true,
    operarAgenda: true,
    verConfiguracoes: true,
    editarConfiguracoes: true,
    gerirIntegracoes: true,
    gerirTiposAtendimento: true,
    gerirIdentidadeVisual: true,
    gerirUsuarios: false,
    criarClinica: false,
    verLog: false,
    gerirBilling: false,
    atenderWhatsapp: true,
  },
  OPERADOR: {
    gerirPacientes: true,
    excluirPaciente: false,
    operarAgenda: true,
    verConfiguracoes: false,
    editarConfiguracoes: false,
    gerirIntegracoes: false,
    gerirTiposAtendimento: true,
    gerirIdentidadeVisual: false,
    gerirUsuarios: false,
    criarClinica: false,
    verLog: false,
    gerirBilling: false,
    atenderWhatsapp: true,
  },
};

/**
 * Verifica se um determinado papel tem uma dada capacidade.
 * @param papel Papel do usuário (ADMIN, PROFISSIONAL, OPERADOR)
 * @param capacidade Capacidade a ser verificada
 * @returns true se o papel tem a capacidade, false caso contrário
 */
export function pode(papel: Papel, capacidade: Capacidade): boolean {
  return capacidadesPorPapel[papel][capacidade];
}

/**
 * Erro lançado quando o usuário não possui aCapacidade necessária.
 */
export class PermissaoNegadaError extends Error {
  constructor(mensagem: string = "Acesso negado: permissão insuficiente") {
    super(mensagem);
    this.name = "PermissaoNegadaError";
  }
}

/**
 * Exige que o usuário tenha aCapacidade para continuar.
 * Lança PermissaoNegadaError se não tiver.
 * @param papel Papel do usuário logado
 * @param capacidade Capacidade necessária
 */
export function exigirPermissao(papel: Papel, capacidade: Capacidade): void {
  if (!pode(papel, capacidade)) {
    throw new PermissaoNegadaError(
      `Permissão negada: necessária a capacidade "${capacidade}"`
    );
  }
}