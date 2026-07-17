"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Switcher de contexto (nível 1 de navegação): Consultório x Mentoria.
// Contexto ativo é sempre DERIVADO DA URL (pathname) — sem estado global —
// pra reload e deep-link manterem o contexto certo. Fica ao lado do
// nome/logo da clínica nos headers que já carregam a fileira de abas
// secundária (painel e as telas de topo da Mentoria).
export default function ContextoSwitcher({ mentoriaDisponivel = true }: { mentoriaDisponivel?: boolean }) {
  const pathname = usePathname();
  const contexto = pathname?.startsWith("/mentoria") ? "mentoria" : "consultorio";

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-bg p-1">
      <Link
        href="/painel"
        prefetch
        className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
          contexto === "consultorio" ? "bg-gold text-bg shadow-sm" : "text-muted hover:text-fg"
        }`}
      >
        Consultório
      </Link>
      {mentoriaDisponivel && (
        <Link
          href="/mentoria/dashboard"
          prefetch
          className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
            contexto === "mentoria" ? "bg-gold text-bg shadow-sm" : "text-muted hover:text-fg"
          }`}
        >
          Mentoria
        </Link>
      )}
    </div>
  );
}
