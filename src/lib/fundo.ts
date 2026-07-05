// Opções de ajuste do fundo de tela (identidade visual white-label) e a
// tradução de cada uma para propriedades CSS de background. Usado tanto no
// preview da tela de Configurações quanto no fundo real do painel, para os
// dois nunca ficarem dessincronizados.

export const AJUSTE_FUNDO_PADRAO = "cover";

export const OPCOES_AJUSTE_FUNDO: { valor: string; label: string }[] = [
  { valor: "cover", label: "Preencher" },
  { valor: "contain", label: "Ajustar" },
  { valor: "center", label: "Centralizado" },
  { valor: "repeat", label: "Lado a lado" },
];

export function fundoAjusteLabel(valor: string): string {
  return OPCOES_AJUSTE_FUNDO.find((o) => o.valor === valor)?.label ?? valor;
}

export function estiloFundoTela(ajuste: string): {
  backgroundSize: string;
  backgroundPosition: string;
  backgroundRepeat: string;
} {
  switch (ajuste) {
    case "contain":
      return { backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat" };
    case "center":
      return { backgroundSize: "auto", backgroundPosition: "center", backgroundRepeat: "no-repeat" };
    case "repeat":
      return { backgroundSize: "auto", backgroundPosition: "top left", backgroundRepeat: "repeat" };
    case "cover":
    default:
      return { backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" };
  }
}
