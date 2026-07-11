import { NextResponse } from "next/server";
import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { obterClienteGoogleDaClinica } from "@/lib/google";

// Normaliza cabeçalho: minúsculo, sem acento, sem espaços extras
function normalizarCabecalho(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// Mapa: nome normalizado da coluna na planilha -> campo do paciente
const MAPA: Record<string, string> = {
  "nome completo": "nome",
  "data de nascimento": "dataNascimento",
  "estado civil": "estadoCivil",
  "nacionalidade": "nacionalidade",
  "seu instagram": "instagram",
  "e-mail": "email",
  "email": "email",
  "endereco completo": "logradouro",
  "cep": "cep",
  "profissao": "profissao",
  "telefone (whatsapp)": "telefone",
  "telefone": "telefone",
  "seu rg": "rg",
  "seu cpf": "cpf",
  "quem indicou?": "quemIndicou",
  "quem indicou": "quemIndicou",
  "carimbo de data/hora": "dataCadastroForms",
  "timestamp": "dataCadastroForms",
};

function soDigitos(s: string): string {
  return (s || "").replace(/\D/g, "");
}

export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) {
    return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  }

  const clinica = await prisma.clinica.findUnique({ where: { id: usuario.clinicaId } });
  if (!clinica) {
    return NextResponse.json({ erro: "clínica não encontrada" }, { status: 404 });
  }

  if (!clinica.sheetsPlanilhaId) {
    return NextResponse.json({ erro: "planilha não configurada nas Configurações" }, { status: 400 });
  }

  const auth = await obterClienteGoogleDaClinica(clinica).catch(() => null);
  if (!auth) {
    return NextResponse.json({ erro: "Google não conectado ou sem permissão de planilhas — reconecte nas Configurações" }, { status: 400 });
  }

  const sheets = google.sheets({ version: "v4", auth });
  const aba = clinica.sheetsAba || "Página1";

  let valores: string[][] = [];
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: clinica.sheetsPlanilhaId,
      range: aba,
    });
    valores = (resp.data.values as string[][]) || [];
  } catch (err: unknown) {
    console.error("Falha ao ler a planilha do Google Sheets:", err);
    return NextResponse.json(
      { erro: "Não foi possível ler a planilha. Verifique se a URL/ID e a aba estão corretos." },
      { status: 400 }
    );
  }

  if (valores.length < 2) {
    return NextResponse.json({ total: 0, novos: 0, existentes: 0, registros: [] });
  }

  const cabecalho = valores[0].map(normalizarCabecalho);
  const linhas = valores.slice(1);

  // CPFs já existentes na clínica
  const pacientesExistentes = await prisma.paciente.findMany({
    where: { clinicaId: clinica.id, cpf: { not: null } },
    select: { cpf: true },
  });
  const cpfsExistentes = new Set(
    pacientesExistentes.map((p) => soDigitos(p.cpf || "")).filter(Boolean)
  );

  const registros = linhas
    .map((linha) => {
      const dados: Record<string, string> = {};
      cabecalho.forEach((col, i) => {
        const campo = MAPA[col];
        if (campo) dados[campo] = (linha[i] || "").trim();
      });
      return dados;
    })
    .filter((d) => (d.nome && d.nome.length > 0) || (d.cpf && d.cpf.length > 0)) // ignora linhas vazias
    .map((d) => {
      const cpfDigitos = soDigitos(d.cpf || "");
      const jaExiste = cpfDigitos.length > 0 && cpfsExistentes.has(cpfDigitos);
      return { ...d, status: jaExiste ? "existente" : "novo" };
    });

  const novos = registros.filter((r) => r.status === "novo").length;
  const existentes = registros.filter((r) => r.status === "existente").length;

  return NextResponse.json({
    total: registros.length,
    novos,
    existentes,
    registros,
  });
}