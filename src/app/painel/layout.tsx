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
    select: { statusAssinatura: true, corPrimaria: true, corSecundaria: true },
  });

  if (clinica && (clinica.statusAssinatura === "INADIMPLENTE" || clinica.statusAssinatura === "CANCELADA")) {
    redirect("/assinatura/regularizar");
  }

  // Identidade visual por clínica: sobrescreve os tokens de cor só quando a
  // clínica tiver salvo um valor (Configurações → Identidade visual). Sem
  // valor, a variável fica de fora do style e o :root de globals.css decide
  // — nunca um valor vazio/inválido aqui.
  const estiloIdentidade: React.CSSProperties = {
    ...(clinica?.corPrimaria ? { "--color-gold": clinica.corPrimaria } : {}),
    ...(clinica?.corSecundaria ? { "--color-bg": clinica.corSecundaria } : {}),
  } as React.CSSProperties;

  return <div style={estiloIdentidade}>{children}</div>;
}
