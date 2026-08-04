-- AlterTable
ALTER TABLE "Clinica" ADD COLUMN     "corPrimaria" TEXT,
ADD COLUMN     "corSecundaria" TEXT,
ADD COLUMN     "duracaoPadraoMin" INTEGER NOT NULL DEFAULT 45,
ADD COLUMN     "horarioLimiteConfirmacao" TEXT NOT NULL DEFAULT '17:00',
ADD COLUMN     "logo" TEXT,
ADD COLUMN     "nomeAssistente" TEXT NOT NULL DEFAULT 'Assistente';

-- CreateTable
CREATE TABLE "HorarioTrabalho" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "diaSemana" "DiaSemana" NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFim" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HorarioTrabalho_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HorarioTrabalho_clinicaId_idx" ON "HorarioTrabalho"("clinicaId");

-- AddForeignKey
ALTER TABLE "HorarioTrabalho" ADD CONSTRAINT "HorarioTrabalho_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
