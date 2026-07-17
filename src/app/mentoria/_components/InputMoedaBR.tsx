"use client";

import { useEffect, useState } from "react";

// Input de valor monetário do módulo Mentoria — mesmo visual dos demais
// inputs (src/app/painel/configuracoes/_components/CampoTexto.tsx), mas com
// máscara BRL aplicada enquanto digita (dígitos preenchem da direita, como
// centavos: "123456" -> "R$ 1.234,56"). O estado exposto ao chamador (value/
// onChange) é sempre número puro — nunca a string mascarada. Sempre
// positivo: só dígitos são aceitos, não há como digitar um sinal de menos.

function paraDigitos(valor: number): string {
  const centavos = Math.round(Math.max(0, valor || 0) * 100);
  return String(centavos);
}

function formatarExibicao(digitos: string): string {
  const reais = Number(digitos || "0") / 100;
  return reais.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function InputMoedaBR({
  value,
  onChange,
  id,
  className,
  required = false,
  disabled = false,
}: {
  value: number;
  onChange: (valor: number) => void;
  id?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [digitos, setDigitos] = useState(() => paraDigitos(value));

  // Sincroniza quando o valor muda por fora (ex.: carregou dados da API) —
  // só quando realmente diverge do que o campo já representa, pra não
  // atropelar o que o usuário está digitando.
  useEffect(() => {
    const atual = Number(digitos || "0") / 100;
    if (Math.abs(atual - (value || 0)) > 0.001) {
      setDigitos(paraDigitos(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const somenteDigitos = e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    setDigitos(somenteDigitos);
    onChange(Number(somenteDigitos || "0") / 100);
  }

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg">R$</span>
      <input
        type="text"
        inputMode="numeric"
        id={id}
        required={required}
        disabled={disabled}
        value={formatarExibicao(digitos)}
        onChange={handleChange}
        className={
          className ??
          "w-full rounded-lg border border-border bg-bg py-2 pl-9 pr-3 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 disabled:cursor-not-allowed disabled:opacity-60"
        }
      />
    </div>
  );
}
