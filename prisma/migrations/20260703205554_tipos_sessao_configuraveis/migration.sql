-- AlterTable
ALTER TABLE "Agendamento" ADD COLUMN     "tipoSessaoId" TEXT;

-- AlterTable: converte a coluna antiga do enum TipoSessao em texto legado
ALTER TABLE "Paciente"
    ADD COLUMN     "tipoSessaoId" TEXT,
    ALTER COLUMN "tipoSessao" DROP NOT NULL,
    ALTER COLUMN "tipoSessao" TYPE TEXT USING "tipoSessao"::text;

ALTER TABLE "Paciente" RENAME COLUMN "tipoSessao" TO "tipoSessaoLegado";

-- DropEnum: o enum antigo cede o nome para a nova tabela configurável
DROP TYPE "TipoSessao";

-- CreateTable
CREATE TABLE "TipoSessao" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cor" TEXT,
    "duracaoPadraoMin" INTEGER NOT NULL DEFAULT 45,
    "ehOnline" BOOLEAN NOT NULL DEFAULT false,
    "valor" DECIMAL(65,30),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TipoSessao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TipoSessao_clinicaId_idx" ON "TipoSessao"("clinicaId");

-- CreateIndex
CREATE INDEX "Agendamento_tipoSessaoId_idx" ON "Agendamento"("tipoSessaoId");

-- CreateIndex
CREATE INDEX "Paciente_tipoSessaoId_idx" ON "Paciente"("tipoSessaoId");

-- AddForeignKey
ALTER TABLE "TipoSessao" ADD CONSTRAINT "TipoSessao_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paciente" ADD CONSTRAINT "Paciente_tipoSessaoId_fkey" FOREIGN KEY ("tipoSessaoId") REFERENCES "TipoSessao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_tipoSessaoId_fkey" FOREIGN KEY ("tipoSessaoId") REFERENCES "TipoSessao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
