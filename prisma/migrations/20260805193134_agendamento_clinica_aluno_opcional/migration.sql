-- DropForeignKey
ALTER TABLE "Agendamento" DROP CONSTRAINT "Agendamento_pacienteId_fkey";

-- DropForeignKey
ALTER TABLE "Agendamento" DROP CONSTRAINT "Agendamento_pacoteId_fkey";

-- AlterTable
ALTER TABLE "Agendamento" ADD COLUMN     "alunoId" TEXT,
ADD COLUMN     "clinicaId" TEXT,
ALTER COLUMN "pacoteId" DROP NOT NULL,
ALTER COLUMN "pacienteId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Agendamento_clinicaId_idx" ON "Agendamento"("clinicaId");

-- CreateIndex
CREATE INDEX "Agendamento_alunoId_idx" ON "Agendamento"("alunoId");

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "Clinica"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_pacoteId_fkey" FOREIGN KEY ("pacoteId") REFERENCES "Pacote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_alunoId_fkey" FOREIGN KEY ("alunoId") REFERENCES "MentoriaAluno"("id") ON DELETE SET NULL ON UPDATE CASCADE;
