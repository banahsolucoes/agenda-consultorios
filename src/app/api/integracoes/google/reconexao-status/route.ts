import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { googlePrecisaReconectar } from "@/lib/google";

// GET /api/integracoes/google/reconexao-status — estado mínimo pro popup
// global de reconexão (GoogleReconexaoModal, montado no layout raiz):
// precisa reconectar? e este usuário tem permissão pra fazer isso? Uma
// checagem leve (1 SELECT), sem chamar a API do Google — diferente de
// GET /api/integracoes/google/status, que busca o e-mail da conta conectada
// e é mais pesada. Sem usuário logado, responde "nada a fazer" em vez de
// 401 — o popup é montado globalmente (todo layout, inclusive páginas
// públicas) e não deve gerar erro de console em tela sem sessão.
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ precisaReconectar: false, podeConectar: false });

  const clinica = await prisma.clinica.findUnique({
    where: { id: usuario.clinicaId },
    select: { nome: true, googleConectado: true, googleTokenValido: true, googleUltimoErroEm: true },
  });
  if (!clinica) return NextResponse.json({ precisaReconectar: false, podeConectar: false });

  return NextResponse.json({
    precisaReconectar: googlePrecisaReconectar(clinica),
    podeConectar: pode(usuario.papel, "gerirIntegracoes"),
    nomeClinica: clinica.nome,
  });
}
