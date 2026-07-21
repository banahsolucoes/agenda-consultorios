-- CreateEnum
CREATE TYPE "StatusSincronizacaoGoogle" AS ENUM ('NAO_APLICAVEL', 'PENDENTE', 'SINCRONIZADO', 'FALHOU');

-- AlterTable
ALTER TABLE "Agendamento" ADD COLUMN     "googleSyncStatus" "StatusSincronizacaoGoogle" NOT NULL DEFAULT 'NAO_APLICAVEL';
