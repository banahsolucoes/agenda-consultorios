-- CreateEnum
CREATE TYPE "SincronizacaoTipo" AS ENUM ('CALENDAR_CRIAR', 'CALENDAR_ATUALIZAR', 'CALENDAR_REMOVER', 'DRIVE_CRIAR_PASTA', 'GMAIL_ENVIAR');

-- CreateEnum
CREATE TYPE "SincronizacaoStatus" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDO', 'FALHA');

-- AlterTable
ALTER TABLE "Clinica" ADD COLUMN     "googleUltimoErro" TEXT,
ADD COLUMN     "googleUltimoErroEm" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "SincronizacaoPendente" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "tipo" "SincronizacaoTipo" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "SincronizacaoStatus" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoErro" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SincronizacaoPendente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SincronizacaoPendente_clinicaId_idx" ON "SincronizacaoPendente"("clinicaId");

-- CreateIndex
CREATE INDEX "SincronizacaoPendente_status_proximaTentativaEm_idx" ON "SincronizacaoPendente"("status", "proximaTentativaEm");

-- AddForeignKey
ALTER TABLE "SincronizacaoPendente" ADD CONSTRAINT "SincronizacaoPendente_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
