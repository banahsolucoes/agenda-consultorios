// src/lib/permissoes.ts
/**
 * Capacidades (permissões) do sistema.
 * Cada papel tem um conjunto de capacidades permitidas.
 */
export type Capacidade =
  | "gerirPacientes"
  | "operarAgenda"
  | "verConfiguracoes"
  | "editarConfiguracoes"
  | "gerirIntegracoes"
  | "gerirTiposAtendimento"
  | "gerirIdentidadeVisual"
  | "gerirUsuarios"
  | "verLog"
  | "gerirBilling";

/**
 * Papel do usuário no sistema.
 * Deve coincidir com o enum Papel do Prisma.
 */
export type Papel = "ADMIN" | "PROFISSIONAL" | "OPERADOR";

/**
 * Mapeamento de papéis para capacidades permitidas.
 * ADMIN: todas as capacidades.
 * PROFISSIONAL: gerirPacientes, operarAgenda, verConfiguracoes = true; restante false.
 * OPERADOR: gerirPacientes, operarAgenda = true; restante false.
 */
export const capacidadesPorPapel: Record<Papel, Record<Capacidade, boolean>> = {
  ADMIN: {
    gerirPacientes: true,
    operarAgenda: true,
    verConfiguracoes: true,
    editarConfiguracoes: true,
    gerirIntegracoes: true,
    gerirTiposAtendimento: true,
    gerirIdentidadeVisual: true,
    gerirUsuarios: true,
    verLog: true,
    gerirBilling: true,
  },
  PROFISSIONAL: {
    gerirPacientes: true,
    operarAgenda: true,
    verConfiguracoes: true,
    editarConfiguracoes: false,
    gerirIntegracoes: false,
    gerirTiposAtendimento: false,
    gerirIdentidadeVisual: false,
    gerirUsuarios: false,
    verLog: false,
    gerirBilling: false,
  },
  OPERADOR: {
    gerirPacientes: true,
    operarAgenda: true,
    verConfiguracoes: false,
    editarConfiguracoes: false,
    gerirIntegracoes: false,
    gerirTiposAtendimento: false,
    gerirIdentidadeVisual: false,
    gerirUsuarios: false,
    verLog: false,
    gerirBilling: false,
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