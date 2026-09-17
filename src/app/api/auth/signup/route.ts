import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { checkRateLimiteLocal } from "@/lib/rateLimit";
import { inicializarClinica } from "@/lib/clinica/inicializar";

const PAPEIS_VALIDOS = ["ADMIN", "PROFISSIONAL", "OPERADOR"] as const;
type PapelValido = (typeof PAPEIS_VALIDOS)[number];

const LIMITE_SIGNUP_POR_HORA = 10;
const JANELA_RATE_LIMIT_MS = 60 * 60 * 1000;

// Mesmo mínimo de src/app/api/usuario/senha/route.ts (SENHA_MINIMA) — o
// Supabase Auth tem seu próprio mínimo (6), mas o padrão já estabelecido
// neste projeto pra troca de senha é 8; o cadastro segue o mesmo.
const SENHA_MINIMA = 8;

// Mesmo padrão de src/app/api/f/[clinicaSlug]/[formularioSlug]/route.ts —
// x-forwarded-for primeiro (é para isso que existe), x-real-ip como
// segundo fallback.
function obterIp(req: NextRequest): string {
  const encaminhado = req.headers.get("x-forwarded-for");
  if (encaminhado) return encaminhado.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "desconhecido";
}

// Mensagem única para toda falha de convite (token inexistente, expirado,
// já usado, ou e-mail que não bate) — nunca revelar qual dos motivos foi.
function respostaConviteInvalido() {
  return NextResponse.json({ erro: "Convite inválido ou expirado" }, { status: 403 });
}

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

// Texto padrão do e-mail de boas-vindas para clínica nova — nunca o texto
// assinado "Fono Pâmela Rachid" do @default do schema (esse default existe
// só para não deixar a coluna sem valor em clínicas antigas/criadas fora
// deste fluxo; aqui sempre sobrescrevemos com o nome real da clínica nova).
function textoBoasVindasPadrao(nomeClinica: string): { assunto: string; corpo: string } {
  return {
    assunto: `Acesso a Gravações com ${nomeClinica}`,
    corpo: `Olá {nome}, tudo bem?\n\nSuas sessões ficam gravadas e disponíveis através do acesso por esse e-mail. É só clicar e acionar seu conteúdo.\n\n{link_pasta}\n\nVale muito a pena ir praticando durante a semana, nos intervalos do dia mesmo… no banho, arrumando a casa, caminhando. Esses pequenos momentos fazem diferença de verdade no seu resultado.\n\nQualquer dúvida, me chama 😊\n\nAtenciosamente\n${nomeClinica}`,
  };
}

// POST /api/auth/signup  body: { email, senha, nome, clinicaId?, papel? } | { email, senha, nome, clinicaNome, convite }
//
// Sem clinicaId: cria uma clínica NOVA e o usuário vira o primeiro ADMIN
// dela — único caminho de cadastro público (não exige login), e por isso
// exige um ConviteClinica válido (token de uso único gerado via
// scripts/gerar-convite.mjs) batendo com o e-mail do cadastro.
//
// Com clinicaId: entra numa clínica JÁ EXISTENTE — isso exige que quem está
// chamando já esteja logado como ADMIN dessa mesma clínica. Nunca confiar em
// clinicaId/papel vindos do corpo sem essa checagem, senão qualquer pessoa
// vira admin de qualquer clínica só sabendo o id dela. Esse caminho não
// passa por convite: quem chama já está autenticado e autorizado.
export async function POST(req: NextRequest) {
  const permitido = checkRateLimiteLocal(`auth-signup:${obterIp(req)}`, LIMITE_SIGNUP_POR_HORA, JANELA_RATE_LIMIT_MS);
  if (!permitido) {
    return NextResponse.json({ erro: "muitas requisições, tente novamente mais tarde" }, { status: 429 });
  }

  const body = await req.json();
  const { email, senha, nome, clinicaId } = body;

  if (!email || !senha || !nome) {
    return NextResponse.json({ erro: "email, senha e nome são obrigatórios" }, { status: 400 });
  }
  if (typeof senha !== "string" || senha.length < SENHA_MINIMA) {
    return NextResponse.json(
      { erro: `a senha deve ter pelo menos ${SENHA_MINIMA} caracteres` },
      { status: 400 }
    );
  }

  let papelFinal: PapelValido;
  let convite: { id: string } | null = null;

  if (clinicaId) {
    const usuarioLogado = await getUsuarioLogado();
    if (!usuarioLogado || usuarioLogado.papel !== "ADMIN" || usuarioLogado.clinicaId !== clinicaId) {
      return NextResponse.json({ erro: "não autorizado a criar usuário nesta clínica" }, { status: 403 });
    }

    papelFinal = PAPEIS_VALIDOS.includes(body.papel) ? body.papel : "PROFISSIONAL";
  } else {
    if (!body.clinicaNome) {
      return NextResponse.json({ erro: "clinicaNome é obrigatório para criar uma clínica nova" }, { status: 400 });
    }

    const tokenConvite = typeof body.convite === "string" ? body.convite.trim() : "";
    if (!tokenConvite) return respostaConviteInvalido();

    const emailNormalizado = String(email).trim().toLowerCase();
    const conviteEncontrado = await prisma.conviteClinica.findUnique({ where: { token: tokenConvite } });

    const conviteValido =
      conviteEncontrado !== null &&
      conviteEncontrado.usadoEm === null &&
      conviteEncontrado.expiraEm.getTime() > Date.now() &&
      conviteEncontrado.email.trim().toLowerCase() === emailNormalizado;

    if (!conviteValido) return respostaConviteInvalido();

    convite = conviteEncontrado;
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
  // pois ele nunca bate com o id real em auth.users. Nada foi criado aqui
  // (nem no nosso banco, nem uma conta nova no Supabase), então não precisa
  // de limpeza.
  if (data.user.identities && data.user.identities.length === 0) {
    return NextResponse.json({ erro: "e-mail já cadastrado" }, { status: 409 });
  }

  const supabaseUserId = data.user.id;

  // A partir daqui existe uma conta no Supabase Auth — qualquer falha no
  // nosso banco a partir deste ponto precisa desfazer essa conta também,
  // senão sobra um usuário Supabase órfão (sem linha em Usuario, não
  // consegue logar de verdade, mas ocupa o e-mail para sempre).
  try {
    if (clinicaId) {
      const usuario = await prisma.usuario.create({
        data: { id: supabaseUserId, clinicaId, nome, email, papel: papelFinal },
      });
      return NextResponse.json({ usuario }, { status: 201 });
    }

    // Clínica nova: Clinica + Usuario + consumo do convite, tudo na mesma
    // transação — se qualquer parte falhar (inclusive o convite já ter sido
    // consumido por uma requisição concorrente), nada é persistido e o
    // catch abaixo remove a conta Supabase recém-criada.
    const resultado = await prisma.$transaction(async (tx) => {
      const textos = textoBoasVindasPadrao(body.clinicaNome);
      const clinica = await tx.clinica.create({
        data: {
          nome: body.clinicaNome,
          slug: gerarSlug(body.clinicaNome),
          emailBoasVindasAssunto: textos.assunto,
          emailBoasVindasCorpo: textos.corpo,
        },
      });

      await inicializarClinica(tx, clinica.id);

      const usuario = await tx.usuario.create({
        data: { id: supabaseUserId, clinicaId: clinica.id, nome, email, papel: papelFinal },
      });

      // updateMany condicional (não update por id) — trava a linha e só
      // confirma se o convite ainda estava livre no momento exato do
      // commit, fechando a corrida entre duas requisições usando o mesmo
      // token ao mesmo tempo.
      const consumo = await tx.conviteClinica.updateMany({
        where: { id: convite!.id, usadoEm: null },
        data: { usadoEm: new Date(), clinicaCriadaId: clinica.id },
      });
      if (consumo.count === 0) {
        throw new Error("convite já foi utilizado por outra requisição");
      }

      return { usuario };
    });

    return NextResponse.json({ usuario: resultado.usuario }, { status: 201 });
  } catch (err) {
    console.error("Falha ao concluir cadastro após criar a conta no Supabase Auth — revertendo:", err);
    const admin = createAdminClient();
    await admin.auth.admin.deleteUser(supabaseUserId).catch((erroLimpeza) => {
      console.error(`Falha ao remover usuário órfão do Supabase Auth (${supabaseUserId}):`, erroLimpeza);
    });
    return NextResponse.json({ erro: "falha ao concluir cadastro" }, { status: 500 });
  }
}
