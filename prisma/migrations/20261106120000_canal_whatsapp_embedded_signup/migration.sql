-- CreateTable
CREATE TABLE "CanalWhatsApp" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanalWhatsApp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CanalWhatsApp_phoneNumberId_key" ON "CanalWhatsApp"("phoneNumberId");

-- CreateIndex
CREATE INDEX "CanalWhatsApp_clinicaId_idx" ON "CanalWhatsApp"("clinicaId");

-- AddForeignKey
ALTER TABLE "CanalWhatsApp" ADD CONSTRAINT "CanalWhatsApp_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

