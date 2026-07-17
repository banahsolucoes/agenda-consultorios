import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

// Página de retorno do checkout do Mercado Pago. Só informativa: NÃO marca
// a clínica como ativa aqui — o estado real da assinatura vem exclusivamente
// do webhook (src/app/api/assinatura/webhook/route.ts). Aqui só exibimos o
// status atual já gravado no banco.
export default async function OnboardingRetornoPage() {
  const usuario = await getUsuarioLogado();
  const clinica = usuario
    ? await prisma.clinica.findUnique({
        where: { id: usuario.clinicaId },
        select: { statusAssinatura: true },
      })
    : null;

  const mensagens: Record<string, string> = {
    TRIAL: "Seu período de teste gratuito está ativo.",
    ATIVA: "Sua assinatura está confirmada e ativa.",
    INADIMPLENTE: "Ainda estamos confirmando o pagamento com o Mercado Pago.",
    CANCELADA: "Sua assinatura não foi confirmada.",
  };

  const status = clinica?.statusAssinatura ?? "TRIAL";

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
        <h1 className="font-serif text-xl font-semibold text-fg">
          Confirmando sua assinatura
        </h1>
        <p className="mt-3 text-sm text-muted">
          {mensagens[status] ??
            "Estamos confirmando sua assinatura com o Mercado Pago. Isso pode levar alguns instantes."}
        </p>
        <Link
          href="/painel"
          className="mt-6 inline-block w-full rounded-lg bg-gold px-4 py-3 text-sm font-semibold text-white"
        >
          Ir para o painel
        </Link>
      </div>
    </div>
  );
}
