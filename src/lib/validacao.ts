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

// Extrai o ID de uma pasta do Google Drive a partir do que o usuário colar:
// um link no formato "?id=XXXX" (compartilhamento "Copiar link"), um link
// "/drive/folders/XXXX" (abrir a pasta pelo navegador), ou já o próprio ID
// da pasta (sem link nenhum).
export function extrairIdPastaDrive(valor: string): string {
  const texto = valor.trim();
  if (!texto) return "";

  try {
    const url = new URL(texto);

    const idQuery = url.searchParams.get("id");
    if (idQuery) return idQuery;

    const partes = url.pathname.split("/").filter(Boolean);
    const indiceFolders = partes.indexOf("folders");
    if (indiceFolders !== -1 && partes[indiceFolders + 1]) {
      return partes[indiceFolders + 1];
    }

    // URL do Drive num formato não reconhecido — devolve como veio, para o
    // operador perceber e corrigir manualmente em vez de perder o valor.
    return texto;
  } catch {
    // Não é uma URL — assume que já é o próprio ID da pasta.
    return texto;
  }
}

// Formato de um ID de arquivo/pasta do Google Drive: alfanumérico + "-"/"_",
// sem espaços nem barras — não garante que a pasta exista de fato (isso só a
// API do Drive confirma), só descarta valores óbvios (URL não reconhecida,
// texto qualquer) antes de tentar.
const ID_PASTA_DRIVE_REGEX = /^[a-zA-Z0-9_-]{10,}$/;
export function pareceIdPastaDriveValido(id: string): boolean {
  return ID_PASTA_DRIVE_REGEX.test(id);
}
