-- CreateTable
CREATE TABLE "ConviteClinica" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nomeClinicaSugerido" TEXT,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),
    "clinicaCriadaId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConviteClinica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConviteClinica_token_key" ON "ConviteClinica"("token");

-- CreateIndex
CREATE INDEX "ConviteClinica_email_idx" ON "ConviteClinica"("email");

-- AddForeignKey
ALTER TABLE "ConviteClinica" ADD CONSTRAINT "ConviteClinica_clinicaCriadaId_fkey" FOREIGN KEY ("clinicaCriadaId") REFERENCES "Clinica"("id") ON DELETE SET NULL ON UPDATE CASCADE;
