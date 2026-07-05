// Renderização do template de e-mail de boas-vindas (Drive Parte 2). Módulo
// isomórfico (sem imports server-only) — usado tanto no servidor (montagem
// final antes de enviar) quanto no cliente (pré-preencher a tela de
// confirmação, que o operador ainda pode editar).

// Substitui {nome} pelo primeiro nome do paciente no assunto.
export function renderizarAssuntoBoasVindas(template: string, primeiroNome: string): string {
  return template.split("{nome}").join(primeiroNome);
}

// Substitui {nome} e {link_pasta} no corpo (texto simples, com placeholders)
// — resultado é o texto pronto para o operador revisar/editar antes de
// enviar. {link_pasta} vira a URL crua aqui; o botão de verdade só é
// montado depois, em renderizarCorpoEmailHtml, a partir do texto final
// (editado ou não).
export function renderizarTemplateBoasVindas(template: string, primeiroNome: string, pastaDriveUrl: string): string {
  return template.split("{nome}").join(primeiroNome).split("{link_pasta}").join(pastaDriveUrl);
}

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Converte o corpo final (texto simples, já com os placeholders resolvidos e
// possivelmente editado à mão) em HTML pronto para envio: qualquer URL
// http(s) encontrada vira um botão "LINK DA SUA PASTA" — não depende de
// nenhum placeholder especial sobreviver à edição, só do link em si continuar
// no texto. O resto vira parágrafos/quebras de linha normais.
export function renderizarCorpoEmailHtml(corpoTextoPlano: string): string {
  const urls: string[] = [];
  const comTokens = corpoTextoPlano.replace(/(https?:\/\/\S+)/g, (url) => {
    urls.push(url);
    return `@@URL${urls.length - 1}@@`;
  });

  const escapado = escaparHtml(comTokens);

  const comBotoes = escapado.replace(/@@URL(\d+)@@/g, (_match, indice: string) => {
    const url = urls[Number(indice)];
    return `<a href="${escaparHtml(url)}" style="display:inline-block;padding:10px 20px;background-color:#c9a96e;color:#0f0f0f;text-decoration:none;border-radius:8px;font-weight:600;">LINK DA SUA PASTA</a>`;
  });

  return comBotoes
    .split(/\n{2,}/)
    .map((paragrafo) => `<p style="margin:0 0 16px 0;">${paragrafo.replace(/\n/g, "<br>")}</p>`)
    .join("");
}
