"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

interface Aluno {
  id: string;
  nomeCompleto: string;
  email: string | null;
  telefone: string | null;
  _count: { contratos: number };
}

export default function MentoriaAlunosPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [alunos, setAlunos] = useState<Aluno[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    fetch("/api/mentoria/alunos")
      .then((r) => (r.ok ? r.json() : []))
      .then(setAlunos)
      .finally(() => setCarregando(false));
  }, []);

  async function handleSair() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/painel")} className="text-sm text-muted hover:text-fg">
              ← Painel
            </button>
            <h1 className="font-serif text-lg font-semibold text-fg">Mentoria — Alunos</h1>
          </div>
          <button
            onClick={handleSair}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg"
          >
            Sair
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={() => router.push("/mentoria/dashboard")}
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                pathname?.startsWith("/mentoria/dashboard") ? "border-gold bg-gold/10 text-gold" : "border-border text-fg hover:bg-bg"
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => router.push("/mentoria/alunos")}
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                pathname?.startsWith("/mentoria/alunos") ? "border-gold bg-gold/10 text-gold" : "border-border text-fg hover:bg-bg"
              }`}
            >
              Alunos
            </button>
            <button
              onClick={() => router.push("/mentoria/comissionados")}
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                pathname?.startsWith("/mentoria/comissionados") ? "border-gold bg-gold/10 text-gold" : "border-border text-fg hover:bg-bg"
              }`}
            >
              Comissionados
            </button>
          </div>
          <button
            onClick={() => router.push("/mentoria/alunos/novo")}
            className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110"
          >
            Novo aluno
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Contatos</th>
                <th className="px-4 py-3">Contratos</th>
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-muted">
                    Carregando...
                  </td>
                </tr>
              ) : alunos.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-muted">
                    Nenhum aluno cadastrado.
                  </td>
                </tr>
              ) : (
                alunos.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => router.push(`/mentoria/alunos/${a.id}`)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-bg"
                  >
                    <td className="px-4 py-3 font-medium text-fg">{a.nomeCompleto}</td>
                    <td className="px-4 py-3 text-fg">
                      {[a.email, a.telefone].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-fg">{a._count.contratos}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
