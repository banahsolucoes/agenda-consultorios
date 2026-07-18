"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Guarda de navegação de todo o módulo Mentoria — só espelho de UX (a
// segurança de verdade está em cada rota de /api/mentoria/**, via
// exigirAcessoMentoria). Um único fetch enxuto (/api/mentoria/acesso, só
// { liberado }) em vez de buscar /api/auth/usuario + /api/clinica inteira em
// paralelo — elimina o round-trip extra que atrasava a entrada em qualquer
// tela do módulo (achado 1 da auditoria de performance).
export default function MentoriaLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [liberado, setLiberado] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelado = false;

    fetch("/api/mentoria/acesso")
      .then((r) => (r.ok ? r.json() : { liberado: false }))
      .then((dados: { liberado: boolean }) => {
        if (cancelado) return;
        if (!dados.liberado) {
          router.replace("/painel");
          return;
        }
        setLiberado(true);
      })
      .catch(() => {
        if (!cancelado) router.replace("/painel");
      });

    return () => {
      cancelado = true;
    };
  }, [router]);

  if (!liberado) {
    return <div className="flex min-h-screen items-center justify-center bg-bg text-sm text-muted">Carregando...</div>;
  }

  return <>{children}</>;
}
