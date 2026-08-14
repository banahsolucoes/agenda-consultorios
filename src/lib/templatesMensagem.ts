// Templates configuráveis por clínica das mensagens de copiar-colar
// (confirmação de sessão e link do Meet) — módulo isomórfico (sem imports
// server-only), usado tanto no popup da agenda quanto no painel do
// paciente, e como valor-padrão ao criar/exibir a clínica.
import { componentesSP } from "@/lib/timezone";

export const TEMPLATE_CONFIRMACAO_PADRAO =
  "{saudacao} {paciente}, tudo bem?! \n" +
  "🌸 Passando para confirmar sua sessão no dia {data} às {hora}hr. 🗓\n" +
  "👉 Podemos confirmar? ✅\n" +
  "⸻\n" +
  "⚠️ Importante\n" +
  "Caso não haja confirmação até hoje, às {horarioLimite}hr, o horário será automaticamente cancelado.\n" +
  "Um abraço\n" +
  "\n" +
  "{assistente} 🥰";

export const TEMPLATE_MEET_PADRAO =
  "Olá {nome}!!!\n" +
  "Esse será o link para sua sessão no dia {data}, às {hora}hr.\n" +
  "🔗 {link} 🔗\n" +
  "Sessão {numero}/{total}\n" +
  "Qualquer coisa, estou por aqui.\n" +
  "\n" +
  "Dai 🥰";

// "Bom dia" (00h–11h59) / "Boa tarde" (12h–17h59) / "Boa noite" (18h–23h59),
// sempre pelo horário atual de São Paulo — independe do fuso do processo
// (em produção o runtime roda em UTC).
export function saudacaoAtual(agora: Date = new Date()): string {
  const hora = componentesSP(agora).hora;
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

// Substitui cada {chave} pelo valor correspondente — split/join em vez de
// regex porque os valores (ex.: link do Meet) podem conter caracteres
// especiais de regex.
export function renderizarTemplateMensagem(template: string, variaveis: Record<string, string>): string {
  return Object.entries(variaveis).reduce(
    (acc, [chave, valor]) => acc.split(`{${chave}}`).join(valor),
    template
  );
}

// Remove a linha inteira que contém {numero}/{total} de templateMeet —
// usado quando a sessão não pertence a um pacote (ex.: reunião avulsa de
// mentorado, sem numeroSessao/totalPacote), pra nunca imprimir "Sessão /"
// com os placeholders vazios. Chamar ANTES de renderizarTemplateMensagem,
// enquanto os placeholders ainda estão literais no texto.
export function removerLinhaSessaoPacote(template: string): string {
  return template
    .split("\n")
    .filter((linha) => !linha.includes("{numero}") && !linha.includes("{total}"))
    .join("\n");
}
