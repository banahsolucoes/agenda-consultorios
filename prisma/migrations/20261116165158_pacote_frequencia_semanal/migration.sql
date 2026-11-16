-- AlterTable
ALTER TABLE "Pacote" ADD COLUMN     "diaSemana2" "DiaSemana",
ADD COLUMN     "frequenciaSemanal" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "horario2" TEXT;

-- CHECK manual (o Prisma não expressa CHECK no schema): frequência só 1 ou 2.
-- Linhas existentes já recebem 1 pelo DEFAULT acima, então o CHECK não falha.
ALTER TABLE "Pacote" ADD CONSTRAINT "Pacote_frequenciaSemanal_check" CHECK ("frequenciaSemanal" IN (1, 2));
