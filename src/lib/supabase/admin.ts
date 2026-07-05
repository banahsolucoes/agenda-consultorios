import { createClient } from "@supabase/supabase-js";

// Cliente admin do Supabase (service role) — usado só no servidor, nunca
// exposto ao navegador. Ignora RLS de propósito: o upload de identidade
// visual já passa pelo nosso próprio controle de acesso (getUsuarioLogado +
// clinicaId) antes de chegar aqui, então não precisa de política de Storage
// própria para escrita.
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
