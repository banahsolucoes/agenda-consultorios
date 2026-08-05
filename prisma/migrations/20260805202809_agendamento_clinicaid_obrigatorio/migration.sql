/*
  Warnings:

  - Made the column `clinicaId` on table `Agendamento` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Agendamento" DROP CONSTRAINT "Agendamento_clinicaId_fkey";

-- AlterTable
ALTER TABLE "Agendamento" ALTER COLUMN "clinicaId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
