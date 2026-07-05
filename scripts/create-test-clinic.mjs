// Script para criar clínica de teste isolada
// Rode com: node scripts/create-test-clinic.mjs

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { createClient } from "@supabase/supabase-js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Supabase admin client (service_role)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRole = process.env.SUPABASE_SECRET_KEY; // service_role key
if (!supabaseUrl || !supabaseServiceRole) {
  console.error("Variáveis de ambiente NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY são necessárias.");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseServiceRole);

// Dados da clínica de teste
const CLINICA_TESTE = {
  nome: "Clínica Teste",
  slug: "clinica-teste",
  // campos opcionais podem ficar null/undefined para usar padrões
  logo: null,
  fundoUrl: null,
  fundoOpacidade: 100,
  fundoAjuste: "cover",
  nomeExibicao: null,
  corPrimaria: null,
  corSecundaria: null,
  duracaoPadraoMin: 45,
  nomeAssistente: "Assistente",
  horarioLimiteConfirmacao: "17:00",
  googleRefreshToken: null,
  googleAccessToken: null,
  googleTokenExpiry: null,
  googleConectado: false,
  googleEscopos: null,
  googleCalendarId: "primary",
  pastaRaizDriveId: null,
  emailBoasVindasAssunto: "Acesso a Gravações com a Fono Pâmela Rachid",
  emailBoasVindasCorpo: "Olá {nome}, tudo bem?\n\nSuas sessões ficam gravadas e disponíveis através do acesso por esse e-mail. É só clicar e acionar seu conteúdo.\n\n{link_pasta}\n\nVale muito a pena ir praticando durante a semana, nos intervalos do dia mesmo… no banho, arrumando a casa, caminhando. Esses pequenos momentos fazem diferença de verdade no seu resultado.\n\nQualquer dúvida, me chama 😊\n\nAtenciosamente\nFono Pâmela Rachid",
};

// Tipos de sessão (mesmas cores/config da clínica Pâmela)
const TIPOS_SESSAO = [
  { nome: "Sessão online", ehOnline: true, cor: "#4285f4", duracaoPadraoMin: 45 },
  { nome: "Sessão presencial", ehOnline: false, cor: "#27ae60", duracaoPadraoMin: 45 },
  { nome: "Avaliação online", ehOnline: true, cor: "#c9a96e", duracaoPadraoMin: 45 },
  { nome: "Avaliação presencial", ehOnline: false, cor: "#f2994a", duracaoPadraoMin: 45 },
];

// Horários de trabalho: segunda a sexta, 08:00-19:30
const DIAS_TRABALHO = ["SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA"];
const HORARIO_TRABALHO = { horaInicio: "08:00", horaFim: "19:30" };

// Usuário de teste no Supabase Auth
const TEST_EMAIL = "teste@banahdigital.com";
const TEST_PASSWORD = "BanahTeste2026!"; // senha temporária (al temporária

async function main() {
  console.log("🔧 Iniciando criação da clínica de teste...");

  // 1. Garantir que a clínica exista
  let clinica = await prisma.clinica.findUnique({ where: { slug: CLINICA_TESTE.slug } });
  if (!clinica) {
    clinica = await prisma.clinica.create({ data: CLINICA_TESTE });
    console.log(`✅ Clínica criada: "${clinica.nome}" (${clinica.id})`);
  } else {
    console.log(`ℹ️  Clínica já existe: "${clinica.nome}" (${clinica.id})`);
  }
  const clinicaId = clinica.id;

  // 2. Criar tipos de sessão (idempotente)
  for (const tipo of TIPOS_SESSAO) {
    const existente = await prisma.tipoSessao.findFirst({
      where: { clinicaId, nome: tipo.nome },
    });
    if (existente) {
      console.log(`  = Tipo de sessão "${tipo.nome}" já existe`);
      continue;
    }
    const criado = await prisma.tipoSessao.create({
      data: { clinicaId, ...tipo },
    });
    console.log(`  ✅ Tipo de sessão "${criado.nome}" criado`);
  }

  // 3. Criar horários de trabalho (idempotente)
  for (const diaSemana of DIAS_TRABALHO) {
    const existente = await prisma.horarioTrabalho.findFirst({
      where: { clinicaId, diaSemana },
    });
    if (existente) {
      console.log(`  = Horário de ${diaSemana} já existe`);
      continue;
    }
    await prisma.horarioTrabalho.create({
      data: { clinicaId, diaSemana, ...HORARIO_TRABALHO },
    });
    console.log(`  ✅ Horário de ${diaSemana} (${HORARIO_TRABALHO.horaInicio}-${HORARIO_TRABALHO.horaFim}) criado`);
  }

  // 4. Criar usuário no Supabase Auth (se ainda não existir)
  let authUser;
  try {
    const { data, error } = await supabase.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true, // confirma email imediatamente (não requer link)
    });
    if (error) throw error;
    authUser = data.user;
    console.log(`✅ Usuário Supabase criado: ${authUser.email} (id: ${authUser.id})`);
  } catch (err) {
    // Talvez o usuário já exista
    if (err.status === 400 && err.message.includes("User already registered")) {
      console.log(`ℹ️  Usuário ${TEST_EMAIL} já existe no Supabase. Tentando obter...`);
      const { data: usersData, error: listError } = await supabase.auth.admin.listUsers();
      if (listError) throw listError;
      const existing = usersData.users.find((u) => u.email === TEST_EMAIL);
      if (!existing) throw new Error("Usuário não encontrado após listagem.");
      authUser = existing;
      console.log(`✅ Usuário existente encontrado: ${authUser.email} (id: ${authUser.id})`);
    } else {
      throw err;
    }
  }

  // 5. Criar registro de Usuario vinculado à clínica (idempotente)
  let usuario = await prisma.usuario.findUnique({ where: { id: authUser.id } });
  if (!usuario) {
    usuario = await prisma.usuario.create({
      data: {
        id: authUser.id,
        clinicaId,
        nome: "Usuário Teste",
        email: TEST_EMAIL,
        papel: "ADMIN",
        criadoEm: new Date(),
      },
    });
    console.log(`✅ Registro de Usuario criado vinculado à clínica (papel ADMIN).`);
  } else {
    console.log(`ℹ️  Registro de Usuario já existe para este auth user.`);
  }

  // 6. Exibir informações para login
  console.log("\n=== INFORMAÇÕES DE ACESSO À CLÍNICA DE TESTE ===");
  console.log(`Clínica ID: ${clinicaId}`);
  console.log(`Email: ${TEST_EMAIL}`);
  console.log(`Senha: ${TEST_PASSWORD}`);
  console.log("\nUse essas credenciais para fazer login em /login e trabalhar na clínica isolada.");
  console.log("===================================================\n");
}

main()
  .catch((err) => {
    console.error("❌ Erro durante a execução:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });