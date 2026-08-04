-- AlterTable
ALTER TABLE "MentoriaAluno" ADD COLUMN     "aceiteTermos" BOOLEAN,
ADD COLUMN     "aceiteTermosTexto" TEXT,
ADD COLUMN     "cep" TEXT,
ADD COLUMN     "cidadeUf" TEXT,
ADD COLUMN     "dataNascimento" TIMESTAMP(3),
ADD COLUMN     "enderecoCompleto" TEXT,
ADD COLUMN     "estadoCivil" TEXT,
ADD COLUMN     "nacionalidade" TEXT,
ADD COLUMN     "profissao" TEXT,
ADD COLUMN     "rg" TEXT,
ADD COLUMN     "submissionData" TIMESTAMP(3),
ADD COLUMN     "submissionId" TEXT,
ADD COLUMN     "submitter" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MentoriaAluno_clinicaId_submissionId_key" ON "MentoriaAluno"("clinicaId", "submissionId");
