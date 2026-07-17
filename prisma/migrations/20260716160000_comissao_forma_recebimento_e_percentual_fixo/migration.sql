-- CreateEnum
CREATE TYPE "FormaRecebimentoComissao" AS ENUM ('ADIANTADO', 'POR_PARCELA');

-- AlterTable
ALTER TABLE "Comissionado" ADD COLUMN     "formaRecebimento" "FormaRecebimentoComissao" NOT NULL DEFAULT 'POR_PARCELA',
ADD COLUMN     "percentualComissao" DECIMAL(5,4);

-- AlterTable
ALTER TABLE "MentoriaComissao" ADD COLUMN     "formaRecebimento" "FormaRecebimentoComissao" NOT NULL DEFAULT 'POR_PARCELA';

-- DataBackfill: preserva o comportamento atual dos comissionados/comissões
-- já cadastrados antes desta fase (forma fixa passa a existir só a partir
-- daqui) — todos os registros existentes viram ADIANTADO.
UPDATE "Comissionado" SET "formaRecebimento" = 'ADIANTADO';

UPDATE "MentoriaComissao" SET "formaRecebimento" = 'ADIANTADO';

-- DataBackfill: copia o percentual da comissão mais recente de cada
-- comissionado para o novo campo fixo percentualComissao; comissionados
-- sem nenhuma comissão vinculada ficam com percentualComissao NULL (o
-- usuário completa o cadastro depois).
UPDATE "Comissionado" c
SET "percentualComissao" = sub.percentual
FROM (
  SELECT DISTINCT ON ("comissionadoId") "comissionadoId", percentual
  FROM "MentoriaComissao"
  ORDER BY "comissionadoId", "criadoEm" DESC
) sub
WHERE c.id = sub."comissionadoId";
