import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/auth/login  body: { email, senha }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, senha } = body;

  if (!email || !senha) {
    return NextResponse.json({ erro: "email e senha são obrigatórios" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: senha,
  });

  if (error) {
    return NextResponse.json({ erro: "credenciais inválidas" }, { status: 401 });
  }

  return NextResponse.json({ usuario: data.user });
}
