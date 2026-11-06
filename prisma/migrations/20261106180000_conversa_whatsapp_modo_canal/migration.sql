-- Roteamento por canal (ARCHITECTURE.md §10.13): conversa passa a distinguir
-- modo (AGENDA/LEAD) e canal de origem (CanalWhatsApp; null = número da agenda).
-- Linhas existentes ficam com modo = 'AGENDA' e canalWhatsAppId = null.

-- AlterTable
ALTER TABLE "ConversaWhatsapp"
  ADD COLUMN "modo" TEXT NOT NULL DEFAULT 'AGENDA',
  ADD COLUMN "canalWhatsAppId" TEXT;

-- AddForeignKey
ALTER TABLE "ConversaWhatsapp"
  ADD CONSTRAINT "ConversaWhatsapp_canalWhatsAppId_fkey"
  FOREIGN KEY ("canalWhatsAppId") REFERENCES "CanalWhatsApp"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- DropIndex
DROP INDEX "ConversaWhatsapp_clinicaId_telefone_idx";

-- CreateIndex
CREATE INDEX "ConversaWhatsapp_clinicaId_telefone_modo_canalWhatsAppId_idx"
  ON "ConversaWhatsapp"("clinicaId", "telefone", "modo", "canalWhatsAppId");
