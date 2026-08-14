// Paleta de cores de evento do Google Calendar — hexes exatamente como a API
// colors().get().event devolve (não os tons usados na UI web do Calendar,
// que renderiza mais escuro/saturado que o hex real da API) — os colorId
// 1–11 são os únicos aceitos, cada um com um hex fixo do lado do Google.
// Cada TipoSessao tem uma cor livre (hex) cadastrada pela clínica; mapeamos
// para o colorId mais próximo por distância euclidiana em RGB — best-effort,
// nunca impede a sincronização do evento (sem cor válida, o evento
// simplesmente não leva colorId, ficando com a cor padrão do calendário).
const PALETA_CORES_GOOGLE: Record<string, string> = {
  "1": "a4bdfc",
  "2": "7ae7bf",
  "3": "dbadff",
  "4": "ff887c",
  "5": "fbd75b",
  "6": "ffb878",
  "7": "46d6db",
  "8": "e1e1e1",
  "9": "5484ed",
  "10": "51b749",
  "11": "dc2127",
};

function hexParaRgb(hex: string): [number, number, number] | null {
  const limpo = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(limpo)) return null;
  return [parseInt(limpo.slice(0, 2), 16), parseInt(limpo.slice(2, 4), 16), parseInt(limpo.slice(4, 6), 16)];
}

// Cor (hex) de um TipoSessao -> colorId do Google Calendar mais próximo.
// Retorna undefined se a cor não estiver definida ou for inválida — nesse
// caso o caller deve omitir o campo colorId da requisição, nunca mandar um
// valor inventado.
export function mapearCorParaGoogleColorId(corHex: string | null | undefined): string | undefined {
  if (!corHex) return undefined;
  const alvo = hexParaRgb(corHex);
  if (!alvo) return undefined;

  let melhorId: string | undefined;
  let menorDistancia = Infinity;
  for (const [colorId, hex] of Object.entries(PALETA_CORES_GOOGLE)) {
    const rgb = hexParaRgb(hex)!;
    const distancia = (rgb[0] - alvo[0]) ** 2 + (rgb[1] - alvo[1]) ** 2 + (rgb[2] - alvo[2]) ** 2;
    if (distancia < menorDistancia) {
      menorDistancia = distancia;
      melhorId = colorId;
    }
  }
  return melhorId;
}
