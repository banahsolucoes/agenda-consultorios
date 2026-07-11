import Link from "next/link";

// Placeholder — templates de e-mail de boas-vindas e mensagens de
// copiar-colar ainda moram em /painel/configuracoes/legado. Só a casca de
// navegação por enquanto (Bloco 2).
export default function MensagensPage() {
  return (
    <div>
      <h2 className="mb-2 font-serif text-lg font-semibold text-fg">Mensagens</h2>
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
