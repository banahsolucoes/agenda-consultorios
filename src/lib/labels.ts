// Traduz os valores brutos dos enums do banco (sempre em MAIÚSCULO) para
// rótulos amigáveis de exibição. O banco nunca é alterado por este helper.

const LABEL_DIA_SEMANA: Record<string, string> = {
  SEGUNDA: "Segunda",
  TERCA: "Terça",
  QUARTA: "Quarta",
  QUINTA: "Quinta",
  SEXTA: "Sexta",
  SABADO: "Sábado",
  DOMINGO: "Domingo",
};

const LABEL_TIPO_PACOTE: Record<string, string> = {
  AVULSA: "Avulsa",
  MENSAL: "Mensal",
  BIMESTRAL: "Bimestral",
  TRIMESTRAL: "Trimestral",
  PERSONALIZADO: "Personalizado",
};

// Cobre status de sessão (AGENDADA..CANCELADA) e status de paciente/pacote (ATIVO/FINALIZADO)
const LABEL_STATUS: Record<string, string> = {
  AGENDADA: "Agendada",
  REAGENDADA: "Reagendada",
  REALIZADA: "Realizada",
  NAO_REALIZADA: "Não realizada",
  CANCELADA: "Cancelada",
  ATIVO: "Ativo",
  CANCELADO: "Cancelado",
  FINALIZADO: "Finalizado",
  PENDENTE: "Pendente",
  CONCLUIDA: "Concluída",
  ARQUIVADA: "Arquivada",
  CONCLUIDO: "Concluído",
};

export function diaSemanaLabel(valor: string): string {
  return LABEL_DIA_SEMANA[valor] ?? valor;
}

export function tipoPacoteLabel(valor: string): string {
  return LABEL_TIPO_PACOTE[valor] ?? valor;
}

export function statusLabel(valor: string): string {
  return LABEL_STATUS[valor] ?? valor;
}

const LABEL_ORIGEM_CADASTRO: Record<string, string> = {
  MANUAL: "Manual",
  FORMS: "Formulário",
};

export function origemCadastroLabel(valor: string): string {
  return LABEL_ORIGEM_CADASTRO[valor] ?? valor;
}

const LABEL_PAPEL: Record<string, string> = {
  ADMIN: "Admin",
  PROFISSIONAL: "Profissional",
  OPERADOR: "Operador",
};

export function papelLabel(valor: string): string {
  return LABEL_PAPEL[valor] ?? valor;
}

const LABEL_TAREFA_TIPO: Record<string, string> = {
  RENOVACAO: "Renovação",
  CONTA: "Conta",
};

export function tarefaTipoLabel(valor: string): string {
  return LABEL_TAREFA_TIPO[valor] ?? valor;
}

const LABEL_TAREFA_RECORRENCIA: Record<string, string> = {
  NENHUMA: "Nenhuma",
  MENSAL: "Mensal",
};

export function tarefaRecorrenciaLabel(valor: string): string {
  return LABEL_TAREFA_RECORRENCIA[valor] ?? valor;
}

const LABEL_FORMA_PAGAMENTO: Record<string, string> = {
  PIX: "Pix",
  CARTAO: "Cartão",
  BOLETO: "Boleto",
  DINHEIRO: "Dinheiro",
  TRANSFERENCIA: "Transferência",
};

export function formaPagamentoLabel(valor: string): string {
  return LABEL_FORMA_PAGAMENTO[valor] ?? valor;
}
