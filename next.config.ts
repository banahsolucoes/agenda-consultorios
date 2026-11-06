import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // As instruções da IA do modo LEAD são lidas do disco em tempo de execução
  // (src/lib/ia/responderLead.ts, readFileSync). O tracing não enxerga leitura
  // por caminho dinâmico, então o .md precisa ser incluído explicitamente no
  // bundle da função do webhook na Vercel.
  outputFileTracingIncludes: {
    "/api/whatsapp/webhook": ["./src/lib/whatsapp/prompts/**/*.md"],
  },
};

export default nextConfig;
