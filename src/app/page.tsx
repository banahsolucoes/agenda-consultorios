import { redirect } from "next/navigation";
import { getUsuarioLogado } from "@/lib/auth";

// "/" nunca renderiza nada — só decide pra onde mandar, usando o mesmo
// jeito de checar sessão que o resto do backend usa (getUsuarioLogado,
// src/lib/auth.ts): com sessão vai pro painel, sem sessão vai pro login.
export default async function Home() {
  const usuario = await getUsuarioLogado();
  redirect(usuario ? "/painel" : "/login");
}
