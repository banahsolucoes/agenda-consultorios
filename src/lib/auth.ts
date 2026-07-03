import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export async function getUsuarioLogado() {
  const supabase = await createClient();
  const resultado = await supabase.auth.getUser();
  const user = resultado.data.user;
  if (!user) return null;

  const usuario = await prisma.usuario.findUnique({
    where: { id: user.id },
  });
  return usuario;
}
