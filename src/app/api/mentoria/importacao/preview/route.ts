import { NextResponse } from "next/server";
import { getUsuarioLogado } from "@/lib/auth";
import { exigirAcessoMentoria } from "@/lib/mentoria";
import { ErroImportacao } from "@/lib/importacao";
import { lerEDeduplicarPlanilhaMentoria } from "@/lib/importacaoMentoria";

// GET /api/mentoria/importacao/preview — pré-visualiza a importação da
// planilha fixa de clientes da Mentoria para a clínica logada, sem gravar
// nada no banco.
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) {
    return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  }
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  try {
    const resultado = await lerEDeduplicarPlanilhaMentoria(usuario.clinicaId);
    return NextResponse.json(resultado);
  } catch (err) {
    if (err instanceof ErroImportacao) {
      return NextResponse.json({ erro: err.message }, { status: 400 });
    }
    console.error("Falha inesperada na pré-visualização da importação de clientes da Mentoria:", err);
    return NextResponse.json({ erro: "Não foi possível pré-visualizar a importação." }, { status: 500 });
  }
}
