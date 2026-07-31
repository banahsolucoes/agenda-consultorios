import { cloudApiProvider } from "./cloudApi";
import type { WhatsAppProvider } from "./types";

export type { ResultadoEnvio, WhatsAppProvider } from "./types";

// Ponto único de indireção entre os call sites e a implementação concreta de
// envio. Nesta fase ignora qualquer parâmetro e sempre retorna a Cloud API —
// seleção dinâmica por clínica ainda não existe (ver ARCHITECTURE.md).
export function getProvider(): WhatsAppProvider {
  return cloudApiProvider;
}
