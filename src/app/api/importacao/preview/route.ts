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
    // O preview (painel/page.tsx) só renderiza nome/cpf/status para a seleção
    // de quem importar — o restante do registro (anamnese, endereço, RG,
    // data de nascimento etc.) só é necessário dentro de POST
    // /api/importacao/executar, no momento da gravação.
    return NextResponse.json({
      ...resultado,
      registros: resultado.registros.map((r) => ({
        nome: r.nome,
        cpf: r.cpf,
        status: r.status,
      })),
    });
  } catch (err) {
    if (err instanceof ErroImportacao) {
      return NextResponse.json({ erro: err.message }, { status: 400 });
    }
    console.error("Falha inesperada na pré-visualização da importação:", err);
    return NextResponse.json({ erro: "Não foi possível pré-visualizar a importação." }, { status: 500 });
  }
}
