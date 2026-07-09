import { NextRequest, NextResponse } from "next/server";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { importarPacientesDaPlanilha } from "@/lib/importacao";

export async function POST(_req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  try {
    const { importados, ignorados, erros } = await importarPacientesDaPlanilha(usuario.clinicaId);

    // Registra em log de auditoria
    await registrarLog(
      usuario.clinicaId,
      usuario.id,
      "IMPORTACAO_MANUAL_SHEETS",
      `Importação manual de planilha executada: ${importados} novos, ${ignorados} existentes, ${erros} erros`
    );

    return NextResponse.json({ importados, ignorados, erros });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ erro: message }, { status: 400 });
  }
}