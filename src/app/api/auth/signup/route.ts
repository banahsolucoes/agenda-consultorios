import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

// POST /api/auth/signup  body: { email, senha, nome, clinicaId, papel? }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, senha, nome, clinicaId } = body;

  if (!email || !senha || !nome || !clinicaId) {
    return NextResponse.json(
      { erro: "email, senha, nome e clinicaId são obrigatórios" },
      { status: 400 }
    );
  }

  const clinica = await prisma.clinica.findUnique({ where: { id: clinicaId } });
  if (!clinica) {
    return NextResponse.json({ erro: "clínica não encontrada" }, { status: 404 });
  }

  const supabase = await createClient();

  // cria no Supabase Auth
  const { data, error } = await supabase.auth.signUp({ email, password: senha });
  if (error || !data.user) {
    return NextResponse.json({ erro: error?.message ?? "falha ao criar" }, { status: 400 });
  }

  // Quando o e-mail já pertence a uma conta confirmada, o Supabase retorna um
  // usuário obfuscado (para não revelar que o e-mail existe) com "identities"
  // vazio em vez de um erro. Criar o Usuario com esse id quebraria o login,
  // pois ele nunca bate com o id real em auth.users.
  if (data.user.identities && data.user.identities.length === 0) {
    return NextResponse.json({ erro: "e-mail já cadastrado" }, { status: 409 });
  }

  // cria o registro de negócio, usando o MESMO id do Auth
  const usuario = await prisma.usuario.create({
    data: {
      id: data.user.id,
      clinicaId,
      nome,
      email,
      papel: body.papel ?? "ADMIN",
    },
  });

  return NextResponse.json({ usuario }, { status: 201 });
}
