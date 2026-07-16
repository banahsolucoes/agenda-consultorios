-- CreateEnum
CREATE TYPE "FormaPagamento" AS ENUM ('PIX', 'CARTAO', 'BOLETO', 'DINHEIRO', 'TRANSFERENCIA');

-- CreateEnum
CREATE TYPE "PapelComissao" AS ENUM ('SELLER', 'CLOSER', 'PRODUTOR');

-- CreateEnum
CREATE TYPE "StatusComissao" AS ENUM ('PENDENTE', 'PAGO', 'ESTORNADO');

-- CreateEnum
CREATE TYPE "StatusContrato" AS ENUM ('ATIVO', 'CONCLUIDO', 'CANCELADO');

-- AlterTable
ALTER TABLE "Clinica" ADD COLUMN     "mentoriaAtivada" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MentoriaAluno" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "nomeCompleto" TEXT NOT NULL,
    "cpf" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "observacoes" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MentoriaAluno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MentoriaContrato" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "alunoId" TEXT NOT NULL,
    "pacote" TEXT NOT NULL,
    "valorTotal" DECIMAL(10,2) NOT NULL,
    "taxaImpostoPct" DECIMAL(5,4) NOT NULL DEFAULT 0.06,
    "assinaturaContrato" TIMESTAMP(3) NOT NULL,
    "totalParcelas" INTEGER NOT NULL,
    "status" "StatusContrato" NOT NULL DEFAULT 'ATIVO',
    "canceladoEm" TIMESTAMP(3),
    "motivoCancelamento" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MentoriaContrato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MentoriaParcela" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "valorBruto" DECIMAL(10,2) NOT NULL,
    "valorLiquido" DECIMAL(10,2),
    "vencimento" TIMESTAMP(3) NOT NULL,
    "dataPagamento" TIMESTAMP(3),
    "formaPagamento" "FormaPagamento",
    "estornoEm" TIMESTAMP(3),
    "valorEstornado" DECIMAL(10,2),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MentoriaParcela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comissionado" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT,
    "telefone" TEXT,
    "papelPadrao" "PapelComissao",
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comissionado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MentoriaComissao" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "comissionadoId" TEXT NOT NULL,
    "papel" "PapelComissao" NOT NULL,
    "percentual" DECIMAL(5,4) NOT NULL,
    "status" "StatusComissao" NOT NULL DEFAULT 'PENDENTE',
    "dataPagamento" TIMESTAMP(3),
    "estornoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MentoriaComissao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MentoriaAluno_clinicaId_idx" ON "MentoriaAluno"("clinicaId");

-- CreateIndex
CREATE UNIQUE INDEX "MentoriaAluno_clinicaId_cpf_key" ON "MentoriaAluno"("clinicaId", "cpf");

-- CreateIndex
CREATE INDEX "MentoriaContrato_clinicaId_idx" ON "MentoriaContrato"("clinicaId");

-- CreateIndex
CREATE INDEX "MentoriaContrato_alunoId_idx" ON "MentoriaContrato"("alunoId");

-- CreateIndex
CREATE INDEX "MentoriaParcela_clinicaId_idx" ON "MentoriaParcela"("clinicaId");

-- CreateIndex
CREATE INDEX "MentoriaParcela_contratoId_idx" ON "MentoriaParcela"("contratoId");

-- CreateIndex
CREATE INDEX "MentoriaParcela_clinicaId_vencimento_idx" ON "MentoriaParcela"("clinicaId", "vencimento");

-- CreateIndex
CREATE INDEX "MentoriaParcela_clinicaId_dataPagamento_idx" ON "MentoriaParcela"("clinicaId", "dataPagamento");

-- CreateIndex
CREATE INDEX "Comissionado_clinicaId_idx" ON "Comissionado"("clinicaId");

-- CreateIndex
CREATE INDEX "MentoriaComissao_clinicaId_idx" ON "MentoriaComissao"("clinicaId");

-- CreateIndex
CREATE INDEX "MentoriaComissao_contratoId_idx" ON "MentoriaComissao"("contratoId");

-- CreateIndex
CREATE INDEX "MentoriaComissao_comissionadoId_idx" ON "MentoriaComissao"("comissionadoId");

-- AddForeignKey
ALTER TABLE "MentoriaAluno" ADD CONSTRAINT "MentoriaAluno_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentoriaContrato" ADD CONSTRAINT "MentoriaContrato_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentoriaContrato" ADD CONSTRAINT "MentoriaContrato_alunoId_fkey" FOREIGN KEY ("alunoId") REFERENCES "MentoriaAluno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentoriaParcela" ADD CONSTRAINT "MentoriaParcela_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentoriaParcela" ADD CONSTRAINT "MentoriaParcela_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "MentoriaContrato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comissionado" ADD CONSTRAINT "Comissionado_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentoriaComissao" ADD CONSTRAINT "MentoriaComissao_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentoriaComissao" ADD CONSTRAINT "MentoriaComissao_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "MentoriaContrato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentoriaComissao" ADD CONSTRAINT "MentoriaComissao_comissionadoId_fkey" FOREIGN KEY ("comissionadoId") REFERENCES "Comissionado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
