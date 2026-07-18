import { NextResponse } from "next/server";
import { getUsuarioLogado } from "@/lib/auth";
import { exigirAcessoMentoria } from "@/lib/mentoria";

// GET /api/mentoria/acesso — checagem enxuta usada pelo guard de navegação
// do módulo (src/app/mentoria/layout.tsx). Reaproveita exigirAcessoMentoria
// (papel + Clinica.mentoriaAtivada, select mínimo) em vez do layout ter que
// buscar /api/clinica inteira (20+ colunas) só pra ler 1 boolean — achado 1
// da auditoria de performance (Documentos Claude/auditoria-mentoria-2026-07-17.md).
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ liberado: false }, { status: 401 });

  const erroAcesso = await exigirAcessoMentoria(usuario);
  return NextResponse.json({ liberado: erroAcesso === null });
}
