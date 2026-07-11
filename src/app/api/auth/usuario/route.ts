import { NextResponse } from "next/server";
import { getUsuarioLogado } from "@/lib/auth";

// GET /api/auth/usuario — só o papel do usuário logado, pro front decidir o
// que mostrar/habilitar. Não é a checagem de segurança (essa é sempre no
// servidor, em cada rota) — é só o espelho pra UI não oferecer um controle
// que a rota já vai recusar.
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  return NextResponse.json({ papel: usuario.papel });
}
