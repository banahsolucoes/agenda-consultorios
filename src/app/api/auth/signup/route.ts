import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

const PAPEIS_VALIDOS = ["ADMIN", "PROFISSIONAL", "OPERADOR"] as const;
type PapelValido = (typeof PAPEIS_VALIDOS)[number];

// Gera um slug único o bastante para uma clínica nova a partir do nome
// (sem acento, minúsculo, com um sufixo aleatório para evitar colisão com
// o índice @unique de Clinica.slug).
function gerarSlug(nome: string): string {
  const base = nome
    .normalize("NFD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${base || "clinica"}-${Math.random().toString(36).slice(2, 8)}`;
}

// POST /api/auth/signup  body: { email, senha, nome, clinicaId?, papel? } | { email, senha, nome, clinicaNome }
//
// Sem clinicaId: cria uma clínica NOVA e o usuário vira o primeiro ADMIN
// dela — é o único caminho de cadastro público (não exige login).
//
// Com clinicaId: entra numa clínica JÁ EXISTENTE — isso exige que quem está
// chamando já esteja logado como ADMIN dessa mesma clínica. Nunca confiar em
// clinicaId/papel vindos do corpo sem essa checagem, senão qualquer pessoa
// vira admin de qualquer clínica só sabendo o id dela.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, senha, nome, clinicaId } = body;

  if (!email || !senha || !nome) {
    return NextResponse.json({ erro: "email, senha e nome são obrigatórios" }, { status: 400 });
  }

  let clinicaIdFinal: string;
  let papelFinal: PapelValido;

  if (clinicaId) {
    const usuarioLogado = await getUsuarioLogado();
    if (!usuarioLogado || usuarioLogado.papel !== "ADMIN" || usuarioLogado.clinicaId !== clinicaId) {
      return NextResponse.json({ erro: "não autorizado a criar usuário nesta clínica" }, { status: 403 });
    }

    clinicaIdFinal = clinicaId;
    papelFinal = PAPEIS_VALIDOS.includes(body.papel) ? body.papel : "PROFISSIONAL";
  } else {
    if (!body.clinicaNome) {
      return NextResponse.json({ erro: "clinicaNome é obrigatório para criar uma clínica nova" }, { status: 400 });
    }

    const clinica = await prisma.clinica.create({
      data: { nome: body.clinicaNome, slug: gerarSlug(body.clinicaNome) },
    });
    clinicaIdFinal = clinica.id;
    papelFinal = "ADMIN"; // primeiro usuário de uma clínica nova é sempre admin dela
  }

  const supabase = await createClient();

  // cria no Supabase Auth
  const { data, error } = await supabase.auth.signUp({ email, password: senha });
  if (error || !data.user) {
    console.error("Falha ao criar conta no Supabase Auth:", error);
    return NextResponse.json({ erro: "falha ao criar conta" }, { status: 400 });
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
      clinicaId: clinicaIdFinal,
      nome,
      email,
      papel: papelFinal,
    },
  });

  return NextResponse.json({ usuario }, { status: 201 });
}
