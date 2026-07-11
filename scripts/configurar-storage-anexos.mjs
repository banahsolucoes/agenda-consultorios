// Cria (se ainda não existir) o bucket "anexos-pacientes" no Supabase
// Storage, usado para os anexos de exame (imagem/PDF) dos pacientes. Bucket
// PRIVADO — nunca tornar público, o acesso é sempre via signed URL depois de
// validar clinicaId do usuário logado. Idempotente: rodar de novo não
// duplica nem reconfigura à toa.
//
// Uso: node scripts/configurar-storage-anexos.mjs

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "anexos-pacientes";
const TAMANHO_MAX_BYTES = Math.floor(4.5 * 1024 * 1024); // 4,5MB
const TIPOS_PERMITIDOS = ["image/jpeg", "image/png", "application/pdf"];

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: buckets, error: erroListar } = await supabase.storage.listBuckets();
  if (erroListar) throw erroListar;

  const existente = buckets.find((b) => b.name === BUCKET);
  if (existente) {
    if (existente.public) {
      throw new Error(
        `Bucket "${BUCKET}" já existe e está PÚBLICO — ele precisa ser privado. Corrija manualmente no painel do Supabase.`
      );
    }
    console.log(`Bucket "${BUCKET}" já existe (privado) — nada a fazer.`);
    return;
  }

  const { error: erroCriar } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: TAMANHO_MAX_BYTES,
    allowedMimeTypes: TIPOS_PERMITIDOS,
  });
  if (erroCriar) throw erroCriar;

  console.log(`Bucket "${BUCKET}" criado (privado, até 4,5MB, tipos: ${TIPOS_PERMITIDOS.join(", ")}).`);
}

main().catch((err) => {
  console.error("Falha ao configurar o bucket de anexos:", err);
  process.exit(1);
});
