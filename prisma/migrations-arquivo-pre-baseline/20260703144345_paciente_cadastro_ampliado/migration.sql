-- CreateEnum
CREATE TYPE "OrigemCadastro" AS ENUM ('MANUAL', 'FORMS');

-- AlterTable
ALTER TABLE "Paciente" ADD COLUMN     "bairro" TEXT,
ADD COLUMN     "cep" TEXT,
ADD COLUMN     "cidade" TEXT,
ADD COLUMN     "complemento" TEXT,
ADD COLUMN     "cpf" TEXT,
ADD COLUMN     "estado" TEXT,
ADD COLUMN     "logradouro" TEXT,
ADD COLUMN     "numero" TEXT,
ADD COLUMN     "origemCadastro" "OrigemCadastro" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "quemIndicou" TEXT;

-- CreateTable
CREATE TABLE "Consentimento" (
    "id" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "versaoTermo" TEXT NOT NULL,
    "finalidade" TEXT NOT NULL,
    "aceitoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consentimento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Consentimento_pacienteId_idx" ON "Consentimento"("pacienteId");

-- AddForeignKey
ALTER TABLE "Consentimento" ADD CONSTRAINT "Consentimento_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
