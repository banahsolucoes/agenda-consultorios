import { NextResponse } from "next/server";
import { getUsuarioLogado } from "@/lib/auth";
import { ErroImportacao, lerEDeduplicarPlanilha } from "@/lib/importacao";

// GET /api/importacao/preview — pré-visualiza a importação da planilha
// configurada na clínica do usuário logado, sem gravar nada no banco.
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) {
    return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  }

  try {
    const resultado = await lerEDeduplicarPlanilha(usuario.clinicaId);
    return NextResponse.json(resultado);
  } catch (err) {
    if (err instanceof ErroImportacao) {
      return NextResponse.json({ erro: err.message }, { status: 400 });
    }
    console.error("Falha inesperada na pré-visualização da importação:", err);
    return NextResponse.json({ erro: "Não foi possível pré-visualizar a importação." }, { status: 500 });
  }
}
