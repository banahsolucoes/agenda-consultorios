-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('ADMIN', 'PROFISSIONAL', 'OPERADOR');

-- CreateEnum
CREATE TYPE "DiaSemana" AS ENUM ('SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO', 'DOMINGO');

-- CreateEnum
CREATE TYPE "TipoSessao" AS ENUM ('ONLINE', 'PRESENCIAL', 'AVAL_ONLINE', 'AVAL_PRESENCIAL');

-- CreateEnum
CREATE TYPE "StatusCliente" AS ENUM ('ATIVO', 'CANCELADO', 'FINALIZADO');

-- CreateEnum
CREATE TYPE "TipoPacote" AS ENUM ('AVULSA', 'MENSAL', 'BIMESTRAL', 'TRIMESTRAL', 'PERSONALIZADO');

-- CreateEnum
CREATE TYPE "StatusPacote" AS ENUM ('ATIVO', 'CANCELADO', 'FINALIZADO');

-- CreateEnum
CREATE TYPE "StatusSessao" AS ENUM ('AGENDADA', 'REAGENDADA', 'REALIZADA', 'NAO_REALIZADA', 'CANCELADA');

-- CreateTable
CREATE TABLE "Clinica" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clinica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "papel" "Papel" NOT NULL DEFAULT 'OPERADOR',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Paciente" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT,
    "email" TEXT,
    "diaPreferido" "DiaSemana" NOT NULL,
    "horarioFixo" TEXT NOT NULL,
    "tipoSessao" "TipoSessao" NOT NULL,
    "statusGeral" "StatusCliente" NOT NULL DEFAULT 'ATIVO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Paciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pacote" (
    "id" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "tipo" "TipoPacote" NOT NULL,
    "totalSessoes" INTEGER NOT NULL,
    "dataInicial" TIMESTAMP(3) NOT NULL,
    "status" "StatusPacote" NOT NULL DEFAULT 'ATIVO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pacote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agendamento" (
    "id" TEXT NOT NULL,
    "pacoteId" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "numeroSessao" INTEGER NOT NULL,
    "totalPacote" INTEGER NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "duracaoMin" INTEGER NOT NULL DEFAULT 45,
    "status" "StatusSessao" NOT NULL DEFAULT 'AGENDADA',
    "googleEventId" TEXT,
    "googleCalendarId" TEXT,
    "linkMeet" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agendamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogAuditoria" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "usuarioId" TEXT,
    "acao" TEXT NOT NULL,
    "detalhe" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogAuditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Clinica_slug_key" ON "Clinica"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE INDEX "Paciente_clinicaId_idx" ON "Paciente"("clinicaId");

-- CreateIndex
CREATE INDEX "Pacote_pacienteId_idx" ON "Pacote"("pacienteId");

-- CreateIndex
CREATE INDEX "Agendamento_pacienteId_idx" ON "Agendamento"("pacienteId");

-- CreateIndex
CREATE INDEX "Agendamento_inicio_idx" ON "Agendamento"("inicio");

-- CreateIndex
CREATE INDEX "LogAuditoria_clinicaId_idx" ON "LogAuditoria"("clinicaId");

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paciente" ADD CONSTRAINT "Paciente_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pacote" ADD CONSTRAINT "Pacote_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_pacoteId_fkey" FOREIGN KEY ("pacoteId") REFERENCES "Pacote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogAuditoria" ADD CONSTRAINT "LogAuditoria_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogAuditoria" ADD CONSTRAINT "LogAuditoria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
