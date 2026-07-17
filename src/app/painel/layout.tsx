import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

// Gate de acesso ao painel: TRIAL e ATIVA liberam normalmente; INADIMPLENTE
// e CANCELADA mandam para a tela de regularização. Não decide papéis/
// capacidades (isso continua em src/lib/permissoes.ts) — só o status de
// assinatura da clínica, sempre lido do banco (nunca do redirect do MP).
export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return <>{children}</>;

  const clinica = await prisma.clinica.findUnique({
    where: { id: usuario.clinicaId },
    select: { statusAssinatura: true },
  });

  if (clinica && (clinica.statusAssinatura === "INADIMPLENTE" || clinica.statusAssinatura === "CANCELADA")) {
    redirect("/assinatura/regularizar");
  }

  return <>{children}</>;
}
