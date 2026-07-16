"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { type Papel } from "@/lib/permissoes";

// Papéis liberados para o módulo Mentoria — mesma checagem direta usada no
// backend (src/lib/mentoria.ts), já que não há uma capacidade correspondente
// em permissoes.ts para esse par de papéis.
const PAPEIS_MENTORIA: Papel[] = ["PROFISSIONAL", "ADMIN"];

// Guarda de navegação de todo o módulo Mentoria — só espelho de UX (a
// segurança de verdade está em cada rota de /api/mentoria/**, via
// exigirAcessoMentoria). Redireciona pro painel se a clínica não tiver o
// módulo ativado ou o usuário não tiver papel liberado.
export default function MentoriaLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [liberado, setLiberado] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelado = false;

    async function verificar() {
      const [resUsuario, resClinica] = await Promise.all([
        fetch("/api/auth/usuario"),
        fetch("/api/clinica"),
      ]);
      if (!resUsuario.ok || !resClinica.ok) {
        if (!cancelado) router.replace("/painel");
        return;
      }
      const usuario = await resUsuario.json();
      const clinica = await resClinica.json();
      const ok = clinica?.mentoriaAtivada === true && PAPEIS_MENTORIA.includes(usuario?.papel);
      if (cancelado) return;
      if (!ok) {
        router.replace("/painel");
        return;
      }
      setLiberado(true);
    }

    verificar();
    return () => {
      cancelado = true;
    };
  }, [router]);

  if (!liberado) {
    return <div className="flex min-h-screen items-center justify-center bg-bg text-sm text-muted">Carregando...</div>;
  }

  return <>{children}</>;
}
