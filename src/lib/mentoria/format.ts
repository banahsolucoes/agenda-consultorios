// Formatação de valores monetários do módulo Mentoria — só apresentação,
// nunca usado para cálculo. Arquivo separado de src/lib/mentoria.ts de
// propósito: aquele importa prisma/NextResponse (server-only) e não pode ser
// empacotado em componentes client; este é puro e seguro nos dois lados.

// Máscara contábil brasileira: "R$ 1.234,56" (positivo/zero) ou
// "(R$ 1.234,56)" (negativo — parênteses, nunca sinal de menos).
export function formatarMoedaBR(valor: number): string {
  const formatado = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(valor));

  return valor < 0 ? `(${formatado})` : formatado;
}
