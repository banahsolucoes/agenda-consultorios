import { redirect } from "next/navigation";

// /painel/configuracoes (raiz) sempre leva pra primeira seção do menu.
export default function ConfiguracoesIndexPage() {
  redirect("/painel/configuracoes/dados-gerais");
}
