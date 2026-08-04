// Genérico de propósito — nunca menciona se a clínica ou o formulário
// existem, só que o link não é válido.
export default function NaoEncontrado() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 text-center shadow-sm">
        <h1 className="font-serif text-xl font-semibold text-fg">Link inválido</h1>
        <p className="mt-2 text-sm text-muted">
          Este formulário não está disponível. Verifique o link recebido ou entre em contato com a clínica.
        </p>
      </div>
    </div>
  );
}
