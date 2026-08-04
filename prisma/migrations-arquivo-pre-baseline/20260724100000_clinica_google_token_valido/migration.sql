-- AlterTable
ALTER TABLE "Clinica" ADD COLUMN     "googleTokenValido" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "googleUltimaFalhaEm" TIMESTAMP(3);
