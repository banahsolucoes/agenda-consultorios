import Link from "next/link";

// Placeholder — conectar/desconectar Google e pasta-mãe do Drive ainda moram
// em /painel/configuracoes/legado. Só a casca de navegação por enquanto (Bloco 2).
export default function IntegracoesPage() {
  return (
    <div>
      <h2 className="mb-2 font-serif text-lg font-semibold text-fg">Integrações</h2>
      <p className="text-sm text-muted">
        Em construção. Por enquanto, edite em{" "}
        <Link href="/painel/configuracoes/legado" className="text-gold hover:underline">
          Configurações (tela antiga)
        </Link>
        .
      </p>
    </div>
  );
}
