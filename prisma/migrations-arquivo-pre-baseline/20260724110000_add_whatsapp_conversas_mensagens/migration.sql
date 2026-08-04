-- CreateTable
CREATE TABLE "ConversaWhatsapp" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "pacienteId" TEXT,
    "telefone" TEXT NOT NULL,
    "janelaAbertaAte" TIMESTAMP(3),
    "estado" TEXT NOT NULL DEFAULT 'aberta',
    "ultimaMensagemEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversaWhatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MensagemWhatsapp" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "direcao" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "respondidaPorIa" BOOLEAN NOT NULL DEFAULT false,
    "wamid" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MensagemWhatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversaWhatsapp_clinicaId_idx" ON "ConversaWhatsapp"("clinicaId");

-- CreateIndex
CREATE INDEX "ConversaWhatsapp_pacienteId_idx" ON "ConversaWhatsapp"("pacienteId");

-- CreateIndex
CREATE INDEX "ConversaWhatsapp_clinicaId_telefone_idx" ON "ConversaWhatsapp"("clinicaId", "telefone");

-- CreateIndex
CREATE INDEX "MensagemWhatsapp_conversaId_idx" ON "MensagemWhatsapp"("conversaId");

-- CreateIndex
CREATE UNIQUE INDEX "MensagemWhatsapp_wamid_key" ON "MensagemWhatsapp"("wamid");

-- AddForeignKey
ALTER TABLE "ConversaWhatsapp" ADD CONSTRAINT "ConversaWhatsapp_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversaWhatsapp" ADD CONSTRAINT "ConversaWhatsapp_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MensagemWhatsapp" ADD CONSTRAINT "MensagemWhatsapp_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "ConversaWhatsapp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
