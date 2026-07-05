// Validação leve: só confere que dá pra interpretar como uma URL absoluta
// (http/https) — não verifica se o link aponta pra algo que existe/é acessível.
export function pareceUrl(valor: string): boolean {
  try {
    const url = new URL(valor);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
