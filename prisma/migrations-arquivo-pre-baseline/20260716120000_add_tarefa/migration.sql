-- CreateEnum
CREATE TYPE "TarefaTipo" AS ENUM ('RENOVACAO', 'CONTA');

-- CreateEnum
CREATE TYPE "TarefaOrigem" AS ENUM ('SISTEMA', 'MANUAL');

-- CreateEnum
CREATE TYPE "TarefaRecorrencia" AS ENUM ('NENHUMA', 'MENSAL');

-- CreateEnum
CREATE TYPE "TarefaStatus" AS ENUM ('PENDENTE', 'CONCLUIDA');

-- CreateTable
CREATE TABLE "Tarefa" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "tipo" "TarefaTipo" NOT NULL,
    "origem" "TarefaOrigem" NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "pacienteId" TEXT,
    "dataVencimento" TIMESTAMP(3),
    "dataAviso" TIMESTAMP(3),
    "recorrencia" "TarefaRecorrencia" NOT NULL DEFAULT 'NENHUMA',
    "status" "TarefaStatus" NOT NULL DEFAULT 'PENDENTE',
    "criadoPor" TEXT,
    "concluidoPor" TEXT,
    "concluidoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tarefa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tarefa_clinicaId_status_idx" ON "Tarefa"("clinicaId", "status");

-- CreateIndex
CREATE INDEX "Tarefa_pacienteId_idx" ON "Tarefa"("pacienteId");

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
