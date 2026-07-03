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
