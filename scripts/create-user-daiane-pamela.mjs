// Script para criar usuário (Daiane) vinculado à clínica da Pâmela
// Rode com: node scripts/create-user-daiane-pamela.mjs

import "dotenv/config";
import crypto from "node:crypto";
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

const CLINICA_SLUG = "pamela-rachid";

const NOVO_USUARIO = {
  nome: "Daiane Aparecida",
  email: "daiane@fonopamelarachid.com.br",
  papel: "OPERADOR",
};

// Gera senha temporária forte e aleatória
function gerarSenhaForte() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*";
  const all = upper + lower + digits + symbols;
  const pick = (set) => set[crypto.randomInt(set.length)];
  let senha = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  for (let i = senha.length; i < 14; i++) senha.push(pick(all));
  // embaralha
  for (let i = senha.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [senha[i], senha[j]] = [senha[j], senha[i]];
  }
  return senha.join("");
}

const SENHA_TEMPORARIA = gerarSenhaForte();

async function main() {
  console.log("🔧 Iniciando criação do usuário Daiane para a clínica da Pâmela...");

  // 1. Buscar clínica pelo slug
  const clinica = await prisma.clinica.findUnique({ where: { slug: CLINICA_SLUG } });
  if (!clinica) {
    throw new Error(`Clínica com slug "${CLINICA_SLUG}" não encontrada.`);
  }
  const clinicaId = clinica.id;
  console.log(`✅ Clínica encontrada: "${clinica.nome}" (${clinicaId})`);

  // 2. Criar usuário no Supabase Auth (idempotente)
  let authUser;
  try {
    const { data, error } = await supabase.auth.admin.createUser({
      email: NOVO_USUARIO.email,
      password: SENHA_TEMPORARIA,
      email_confirm: true, // confirma email imediatamente (não requer link)
    });
    if (error) throw error;
    authUser = data.user;
    console.log(`✅ Usuário Supabase criado: ${authUser.email} (id: ${authUser.id})`);
  } catch (err) {
    if (err.status === 400 || err.message?.includes("already registered") || err.message?.includes("already been registered")) {
      console.log(`ℹ️  Usuário ${NOVO_USUARIO.email} já existe no Supabase. Buscando...`);
      const { data: usersData, error: listError } = await supabase.auth.admin.listUsers();
      if (listError) throw listError;
      const existing = usersData.users.find((u) => u.email === NOVO_USUARIO.email);
      if (!existing) throw new Error("Usuário não encontrado após listagem.");
      authUser = existing;
      console.log(`✅ Usuário existente encontrado: ${authUser.email} (id: ${authUser.id})`);
    } else {
      throw err;
    }
  }

  // 3. Criar registro de Usuario vinculado à clínica (idempotente, mesmo id do Auth)
  let usuario = await prisma.usuario.findUnique({ where: { id: authUser.id } });
  if (!usuario) {
    usuario = await prisma.usuario.create({
      data: {
        id: authUser.id,
        clinicaId,
        nome: NOVO_USUARIO.nome,
        email: NOVO_USUARIO.email,
        papel: NOVO_USUARIO.papel,
        criadoEm: new Date(),
      },
    });
    console.log(`✅ Registro de Usuario criado vinculado à clínica (papel ${NOVO_USUARIO.papel}).`);
  } else {
    console.log(`ℹ️  Registro de Usuario já existe para este auth user (id: ${usuario.id}).`);
  }

  // 4. Exibir informações finais
  console.log("\n=== USUÁRIO CRIADO PARA A CLÍNICA DA PÂMELA ===");
  console.log(`Email: ${NOVO_USUARIO.email}`);
  console.log(`Senha temporária: ${SENHA_TEMPORARIA}`);
  console.log(`Clínica ID: ${clinicaId}`);
  console.log(`Papel: ${NOVO_USUARIO.papel}`);
  console.log("\nRepasse a senha à Daiane. Ela pode trocá-la depois via 'Esqueci minha senha'.");
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
