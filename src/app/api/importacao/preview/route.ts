import { NextResponse } from "next/server";
import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { obterClienteGoogleDaClinica } from "@/lib/google";
import { normalizarCabecalho, MAPA, soDigitos } from "@/lib/importacao-utils";

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
    return NextResponse.json({ erro: "planilha não configurada" }, { status: 400 });
  }

  // Obtém o cliente Google da clínica
  const auth = await obterClienteGoogleDaClinica(clinica).catch(() => null);
  if (!auth) {
    return NextResponse.json({ erro: "Google não conectado ou sem permissão de planilhas — reconecte nas Configurações" }, { status: 400 });
  }

  const sheets = google.sheets({ version: "v4", auth });
  const aba = clinica.sheetsAba || "Página1";

  // Lê os dados da planilha
  let valores: string[][] = [];
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: clinica.sheetsPlanilhaId,
      range: aba,
    });
    valores = (resp.data.values as string[][]) || [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ erro: `Não foi possível ler a planilha: ${message}` }, { status: 400 });
  }

  if (valores.length < 2) {
    // Nenhum dado além do cabeçalho
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

  // Processa cada linha
  const registros = [];

  for (const linha of linhas) {
    const dados: Record<string, string> = {};
    cabecalho.forEach((col, i) => {
      const campo = MAPA[col];
      if (campo) {
        dados[campo] = (linha[i] || "").trim();
      }
    });

    // Ignora linhas vazias (sem nome e sem CPF)
    if (!(dados.nome && dados.nome.length > 0) && !(dados.cpf && dados.cpf.length > 0)) {
      continue;
    }

    const cpfDigitos = soDigitos(dados.cpf || "");
    const jaExiste = cpfDigitos.length > 0 && cpfsExistentes.has(cpfDigitos);

    registros.push({
      ...dados,
      novo: !jaExiste,
      cpfFormatado: cpfDigitos,
    });
  }

  const novos = registros.filter((r) => r.novo).length;
  const existentes = registros.filter((r) => !r.novo).length;

  return NextResponse.json({ total: registros.length, novos, existentes, registros });
}