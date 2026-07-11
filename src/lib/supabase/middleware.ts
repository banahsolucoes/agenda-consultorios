import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@vercel/firewall";
import { checkRateLimiteLocal } from "@/lib/rateLimit";

function obterIp(request: NextRequest): string {
  const encaminhado = request.headers.get("x-forwarded-for");
  if (encaminhado) return encaminhado.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "desconhecido";
}

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const ehRotaAuth = path.startsWith("/api/auth");
  const ip = obterIp(request);

  // /api/auth (login/signup) é o alvo mais óbvio de força bruta, por isso
  // tem um limite bem mais apertado que o resto da API.
  const idLimite = ehRotaAuth ? "api-auth" : "api-geral";
  const { max, janelaMs } = ehRotaAuth ? { max: 20, janelaMs: 60_000 } : { max: 120, janelaMs: 60_000 };

  // Camada 1: Vercel Firewall — só tem efeito se existir uma regra com o
  // mesmo ID configurada no dashboard (Security > Firewall). Sem a regra,
  // retorna rateLimited: false e caímos só no fallback local.
  const doFirewall = await checkRateLimit(idLimite, { rateLimitKey: ip, request }).catch(
    () => ({ rateLimited: false as const })
  );
  // Camada 2: fallback em memória local, sempre ativo.
  const permitidoLocal = checkRateLimiteLocal(`${idLimite}:${ip}`, max, janelaMs);

  if (doFirewall.rateLimited || !permitidoLocal) {
    return NextResponse.json({ erro: "muitas requisições, tente novamente em instantes" }, { status: 429 });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // rotas de API protegidas exigem login (exceto /api/auth)
  const rotaProtegida = path.startsWith("/api/") && !ehRotaAuth;

  if (rotaProtegida && !user) {
    return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  }

  return supabaseResponse;
}
