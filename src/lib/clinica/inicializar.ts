import { Prisma } from "@/generated/prisma";

type TransacaoPrisma = Prisma.TransactionClient;

// Dados mínimos para uma clínica recém-criada conseguir operar — chamada
// dentro da MESMA transação que cria a Clinica (POST /api/auth/signup),
// nunca solta. Escopo definido pela auditoria de onboarding
// (docs/auditorias/auditoria-onboarding.md, item 10): sem pelo menos 1
// TipoSessao, POST /api/pacientes rejeita qualquer cadastro de paciente
// (tipoSessaoId é obrigatório) — esse é o único bloqueador real encontrado.
// HorarioTrabalho vazio já tem fallback seguro no código (grade padrão
// 08:00–19:30, ver sessoes/[id]/route.ts), então não faz parte do mínimo.
export async function inicializarClinica(tx: TransacaoPrisma, clinicaId: string): Promise<void> {
  await tx.tipoSessao.create({
    data: {
      clinicaId,
      nome: "Sessão individual",
      duracaoPadraoMin: 50,
      ehOnline: false,
      ehAtendimentoUnico: false,
    },
  });
}
