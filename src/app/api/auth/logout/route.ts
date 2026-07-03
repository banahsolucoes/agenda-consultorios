import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/auth/logout — encerra a sessão do Supabase
export async function POST() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    return NextResponse.json({ erro: "falha ao encerrar sessão" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
