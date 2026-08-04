// Validação de CPF por dígito verificador (algoritmo padrão) — extraída dos
// scripts de backfill de anamnese (Bloco E2/reprocessar-anamnese.ts) para uso
// compartilhado. Puro, sem dependências de servidor — seguro para import em
// Client Component (usado no formulário público) e em Route Handler.

export function soDigitosCpf(s: string): string {
  return (s || "").replace(/\D/g, "");
}

export function cpfMatematicamenteValido(cpf: string): boolean {
  const cpfDigitos = soDigitosCpf(cpf);
  if (!/^\d{11}$/.test(cpfDigitos)) return false;
  if (/^(\d)\1{10}$/.test(cpfDigitos)) return false; // todos os dígitos iguais

  const digitos = cpfDigitos.split("").map(Number);

  const calcularDv = (base: number[]): number => {
    let soma = 0;
    let peso = base.length + 1;
    for (const d of base) {
      soma += d * peso;
      peso--;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const dv1 = calcularDv(digitos.slice(0, 9));
  if (dv1 !== digitos[9]) return false;
  const dv2 = calcularDv(digitos.slice(0, 10));
  if (dv2 !== digitos[10]) return false;

  return true;
}
