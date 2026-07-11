import Link from "next/link";

// Placeholder — logo, fundo de tela e cores ainda moram em
// /painel/configuracoes/legado. Só a casca de navegação por enquanto (Bloco 2).
export default function IdentidadePage() {
  return (
    <div>
      <h2 className="mb-2 font-serif text-lg font-semibold text-fg">Identidade visual</h2>
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
