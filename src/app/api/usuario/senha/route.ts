import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUsuarioLogado } from "@/lib/auth";

const SENHA_MINIMA = 8;

// POST /api/usuario/senha — troca a senha do PRÓPRIO usuário logado.
// Age sempre sobre a sessão de quem chama (supabase.auth.updateUser), então
// não altera senha de terceiros e não precisa de checagem de papel — qualquer
// usuário autenticado pode trocar a própria senha. body: { senha }
export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const senha = typeof body?.senha === "string" ? body.senha : "";

  if (senha.length < SENHA_MINIMA) {
    return NextResponse.json(
      { erro: `a senha deve ter pelo menos ${SENHA_MINIMA} caracteres` },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: senha });
  if (error) {
    console.error("Falha ao trocar a senha do usuário:", error);
    return NextResponse.json({ erro: "não foi possível alterar a senha" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
