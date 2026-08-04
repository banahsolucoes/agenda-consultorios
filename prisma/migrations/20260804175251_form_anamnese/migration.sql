-- CreateEnum
CREATE TYPE "TipoPergunta" AS ENUM ('TEXTO_CURTO', 'TEXTO_LONGO', 'SIM_NAO', 'MULTIPLA_ESCOLHA', 'DATA', 'EMAIL', 'TELEFONE', 'CPF', 'CEP');

-- CreateEnum
CREATE TYPE "StatusEnvio" AS ENUM ('PENDENTE', 'PROCESSADO', 'IGNORADO', 'ERRO');

-- CreateTable
CREATE TABLE "FormularioAnamnese" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "textoConsentimento" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormularioAnamnese_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerguntaFormulario" (
    "id" TEXT NOT NULL,
    "formularioId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "rotulo" TEXT NOT NULL,
    "descricao" TEXT,
    "tipo" "TipoPergunta" NOT NULL,
    "obrigatoria" BOOLEAN NOT NULL DEFAULT false,
    "opcoes" TEXT[],
    "campoPaciente" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerguntaFormulario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvioFormulario" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "formularioId" TEXT NOT NULL,
    "pacienteId" TEXT,
    "status" "StatusEnvio" NOT NULL DEFAULT 'PENDENTE',
    "consentimentoAceito" BOOLEAN NOT NULL,
    "textoConsentimentoSnapshot" TEXT NOT NULL,
    "consentimentoEm" TIMESTAMP(3) NOT NULL,
    "ipOrigem" TEXT,
    "userAgent" TEXT,
    "observacaoProcessamento" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvioFormulario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RespostaFormulario" (
    "id" TEXT NOT NULL,
    "envioId" TEXT NOT NULL,
    "perguntaId" TEXT NOT NULL,
    "rotuloSnapshot" TEXT NOT NULL,
    "valor" TEXT NOT NULL,

    CONSTRAINT "RespostaFormulario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FormularioAnamnese_clinicaId_idx" ON "FormularioAnamnese"("clinicaId");

-- CreateIndex
CREATE UNIQUE INDEX "FormularioAnamnese_clinicaId_slug_key" ON "FormularioAnamnese"("clinicaId", "slug");

-- CreateIndex
CREATE INDEX "PerguntaFormulario_formularioId_idx" ON "PerguntaFormulario"("formularioId");

-- CreateIndex
CREATE INDEX "PerguntaFormulario_formularioId_ordem_idx" ON "PerguntaFormulario"("formularioId", "ordem");

-- CreateIndex
CREATE INDEX "EnvioFormulario_clinicaId_idx" ON "EnvioFormulario"("clinicaId");

-- CreateIndex
CREATE INDEX "EnvioFormulario_formularioId_idx" ON "EnvioFormulario"("formularioId");

-- CreateIndex
CREATE INDEX "EnvioFormulario_pacienteId_idx" ON "EnvioFormulario"("pacienteId");

-- CreateIndex
CREATE INDEX "RespostaFormulario_envioId_idx" ON "RespostaFormulario"("envioId");

-- CreateIndex
CREATE INDEX "RespostaFormulario_perguntaId_idx" ON "RespostaFormulario"("perguntaId");

-- AddForeignKey
ALTER TABLE "FormularioAnamnese" ADD CONSTRAINT "FormularioAnamnese_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerguntaFormulario" ADD CONSTRAINT "PerguntaFormulario_formularioId_fkey" FOREIGN KEY ("formularioId") REFERENCES "FormularioAnamnese"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvioFormulario" ADD CONSTRAINT "EnvioFormulario_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvioFormulario" ADD CONSTRAINT "EnvioFormulario_formularioId_fkey" FOREIGN KEY ("formularioId") REFERENCES "FormularioAnamnese"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvioFormulario" ADD CONSTRAINT "EnvioFormulario_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RespostaFormulario" ADD CONSTRAINT "RespostaFormulario_envioId_fkey" FOREIGN KEY ("envioId") REFERENCES "EnvioFormulario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RespostaFormulario" ADD CONSTRAINT "RespostaFormulario_perguntaId_fkey" FOREIGN KEY ("perguntaId") REFERENCES "PerguntaFormulario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

