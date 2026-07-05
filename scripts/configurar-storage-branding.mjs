// Cria (se ainda não existir) o bucket "branding" no Supabase Storage, usado
// para logos e fundos de tela das clínicas (identidade visual white-label).
// Idempotente: rodar de novo não duplica nem reconfigura à toa.
//
// Uso: node scripts/configurar-storage-branding.mjs

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "branding";
const TAMANHO_MAX_BYTES = 5 * 1024 * 1024; // 5MB
const TIPOS_PERMITIDOS = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: buckets, error: erroListar } = await supabase.storage.listBuckets();
  if (erroListar) throw erroListar;

  const existente = buckets.find((b) => b.name === BUCKET);
  if (existente) {
    console.log(`Bucket "${BUCKET}" já existe (public: ${existente.public}) — nada a fazer.`);
    return;
  }

  const { error: erroCriar } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: TAMANHO_MAX_BYTES,
    allowedMimeTypes: TIPOS_PERMITIDOS,
  });
  if (erroCriar) throw erroCriar;

  console.log(`Bucket "${BUCKET}" criado (público, até 5MB, tipos: ${TIPOS_PERMITIDOS.join(", ")}).`);
}

main().catch((err) => {
  console.error("Falha ao configurar o bucket de branding:", err);
  process.exit(1);
});
