-- CreateEnum
CREATE TYPE "StatusAssinatura" AS ENUM ('TRIAL', 'ATIVA', 'INADIMPLENTE', 'CANCELADA');

-- AlterTable
ALTER TABLE "Clinica" ADD COLUMN     "assinaturaAtualizadaEm" TIMESTAMP(3),
ADD COLUMN     "mpPayerEmail" TEXT,
ADD COLUMN     "mpPreapprovalId" TEXT,
ADD COLUMN     "statusAssinatura" "StatusAssinatura" NOT NULL DEFAULT 'TRIAL',
ADD COLUMN     "trialFim" TIMESTAMP(3);
