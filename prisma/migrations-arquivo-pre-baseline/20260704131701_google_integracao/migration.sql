-- AlterTable
ALTER TABLE "Clinica" ADD COLUMN     "googleAccessToken" TEXT,
ADD COLUMN     "googleCalendarId" TEXT DEFAULT 'primary',
ADD COLUMN     "googleConectado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "googleRefreshToken" TEXT,
ADD COLUMN     "googleTokenExpiry" TIMESTAMP(3);
