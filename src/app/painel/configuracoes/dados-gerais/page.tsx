import Link from "next/link";

// Placeholder — o conteúdo real (nome da clínica, cores, dados cadastrais)
// ainda mora em /painel/configuracoes/legado. Só a casca de navegação por
// enquanto (Bloco 2); a migração do conteúdo vem depois.
export default function DadosGeraisPage() {
  return (
    <div>
      <h2 className="mb-2 font-serif text-lg font-semibold text-fg">Dados gerais</h2>
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
