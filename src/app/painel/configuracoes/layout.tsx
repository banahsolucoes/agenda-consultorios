"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { pode, type Papel, type Capacidade } from "@/lib/permissoes";

interface ItemMenu {
  slug: string;
  label: string;
  // null = liberado pra qualquer usuário logado (nenhuma capacidade exigida)
  capacidade: Capacidade | null;
}

const ITENS_MENU: ItemMenu[] = [
  { slug: "dados-gerais", label: "Dados gerais", capacidade: "editarConfiguracoes" },
  { slug: "atendimento", label: "Atendimento", capacidade: null },
  { slug: "identidade", label: "Identidade visual", capacidade: "gerirIdentidadeVisual" },
  { slug: "integracoes", label: "Integrações", capacidade: "gerirIntegracoes" },
  { slug: "mensagens", label: "Mensagens", capacidade: "editarConfiguracoes" },
  { slug: "seguranca", label: "Segurança", capacidade: null },
];

// Casca de navegação por seções da tela de Configurações. Só espelho de UX —
// a segurança de verdade continua nas rotas de API (src/lib/permissoes.ts +
// cada rota, Bloco 1). /legado tem seu próprio header completo (a tela
// antiga, ainda intacta) e não deve ganhar essa casca por cima.
export default function ConfiguracoesLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [papel, setPapel] = useState<Papel | null>(null);
  const [drawerAberto, setDrawerAberto] = useState(false);

  useEffect(() => {
    fetch("/api/auth/usuario")
      .then((r) => (r.ok ? r.json() : null))
      .then((dados) => dados && setPapel(dados.papel));
  }, []);

  const emLegado = pathname?.startsWith("/painel/configuracoes/legado") ?? false;

  const itensPermitidos = papel
    ? ITENS_MENU.filter((item) => !item.capacidade || pode(papel, item.capacidade))
    : [];

  // Se a seção atual da URL não está entre as permitidas pro papel do
  // usuário, manda de volta pro painel — evita um OPERADOR ficar parado numa
  // seção bloqueada só porque digitou a URL direto.
  useEffect(() => {
    if (emLegado || papel === null) return;
    const slugAtual = pathname?.split("/").pop();
    const item = ITENS_MENU.find((i) => i.slug === slugAtual);
    if (item && item.capacidade && !pode(papel, item.capacidade)) {
      router.replace("/painel");
    }
  }, [papel, pathname, emLegado, router]);

  async function handleSair() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  if (emLegado) return <>{children}</>;

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDrawerAberto(true)}
              className="rounded-lg border border-border p-2 text-fg hover:bg-bg sm:hidden"
              aria-label="Abrir menu de configurações"
            >
              <IconHamburguer className="h-5 w-5" />
            </button>
            <button
              onClick={() => router.push("/painel")}
              className="text-sm text-muted hover:text-fg"
            >
              ← Painel
            </button>
            <h1 className="font-serif text-lg font-semibold text-fg">
              Configurações
            </h1>
          </div>
          <button
            onClick={handleSair}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg"
          >
            Sair
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-5xl gap-6 px-6 py-8">
        {/* Menu lateral fixo — desktop */}
        <nav className="hidden w-52 shrink-0 sm:block">
          <MenuSecoes itens={itensPermitidos} pathname={pathname} onNavegar={() => {}} />
        </nav>

        {/* Drawer — mobile */}
        {drawerAberto && (
          <div className="fixed inset-0 z-50 flex sm:hidden">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setDrawerAberto(false)}
            />
            <nav className="relative flex h-full w-64 flex-col border-r border-border bg-surface p-4 shadow-lg">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm font-semibold text-fg">Seções</span>
                <button
                  onClick={() => setDrawerAberto(false)}
                  className="text-muted hover:text-fg"
                  aria-label="Fechar menu"
                >
                  ✕
                </button>
              </div>
              <MenuSecoes
                itens={itensPermitidos}
                pathname={pathname}
                onNavegar={() => setDrawerAberto(false)}
              />
            </nav>
          </div>
        )}

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

function MenuSecoes({
  itens,
  pathname,
  onNavegar,
}: {
  itens: ItemMenu[];
  pathname: string | null;
  onNavegar: () => void;
}) {
  return (
    <ul className="space-y-1">
      {itens.map((item) => {
        const href = `/painel/configuracoes/${item.slug}`;
        const ativo = pathname === href;
        return (
          <li key={item.slug}>
            <Link
              href={href}
              onClick={onNavegar}
              className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                ativo ? "bg-gold/10 text-gold" : "text-fg hover:bg-surface"
              }`}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function IconHamburguer({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M3 6h14M3 10h14M3 14h14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
