import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimiteLocal } from "@/lib/rateLimit";
import { validarValorPorTipo } from "@/lib/formularioPublico";

const LIMITE_ENVIOS_POR_HORA = 5;
const JANELA_RATE_LIMIT_MS = 60 * 60 * 1000;
const LIMITE_PAYLOAD_BYTES = 100_000;

// Resposta única, indistinguível de sucesso real — usada tanto pro caminho
// feliz quanto pro honeypot (bot preenchido) e pro rate limit. O formulário
// NUNCA pode virar ferramenta de consulta de cadastro (se um CPF já existe,
// se a clínica existe, etc.) — nem por status code, nem por texto.
function respostaGenerica() {
  return NextResponse.json({ ok: true }, { status: 200 });
}

function obterIp(request: NextRequest): string {
  const encaminhado = request.headers.get("x-forwarded-for");
  if (encaminhado) return encaminhado.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "desconhecido";
}

interface RespostaEntrada {
  perguntaId: string;
  valor: string;
}

interface PayloadEntrada {
  respostas: RespostaEntrada[];
  consentimentoAceito: boolean;
  website?: string; // honeypot
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clinicaSlug: string; formularioSlug: string }> }
) {
  const { clinicaSlug, formularioSlug } = await params;
  const ip = obterIp(req);

  // Rate limit por IP — antes de qualquer trabalho de parsing/DB.
  const permitido = checkRateLimiteLocal(
    `formulario-publico:${ip}`,
    LIMITE_ENVIOS_POR_HORA,
    JANELA_RATE_LIMIT_MS
  );
  if (!permitido) {
    return NextResponse.json({ erro: "muitas requisições, tente novamente mais tarde" }, { status: 429 });
  }

  // Limite de payload — lido como texto antes de qualquer JSON.parse.
  const bruto = await req.text();
  if (Buffer.byteLength(bruto, "utf8") > LIMITE_PAYLOAD_BYTES) {
    return NextResponse.json({ erro: "payload excede o limite permitido" }, { status: 413 });
  }

  let payload: PayloadEntrada;
  try {
    payload = JSON.parse(bruto);
  } catch {
    return NextResponse.json({ erro: "payload inválido" }, { status: 400 });
  }

  if (!payload || typeof payload !== "object" || !Array.isArray(payload.respostas)) {
    return NextResponse.json({ erro: "payload inválido" }, { status: 400 });
  }

  // Honeypot: campo que só um bot preenche. Responde sucesso, descarta sem
  // gravar nada — não damos ao bot nenhum sinal de que foi detectado.
  if (payload.website && payload.website.trim().length > 0) {
    return respostaGenerica();
  }

  if (payload.consentimentoAceito !== true) {
    return NextResponse.json({ erro: "consentimento é obrigatório" }, { status: 400 });
  }

  // clinicaId/formularioId são derivados EXCLUSIVAMENTE dos slugs da URL —
  // qualquer clinicaId/formularioId/pacienteId no body é ignorado (nem lido).
  const clinica = await prisma.clinica.findUnique({
    where: { slug: clinicaSlug },
    select: { id: true },
  });
  if (!clinica) {
    return NextResponse.json({ erro: "formulário não encontrado" }, { status: 404 });
  }

  const formulario = await prisma.formularioAnamnese.findUnique({
    where: { clinicaId_slug: { clinicaId: clinica.id, slug: formularioSlug } },
    select: {
      id: true,
      ativo: true,
      textoConsentimento: true,
      perguntas: {
        select: { id: true, rotulo: true, tipo: true, obrigatoria: true, ativa: true },
      },
    },
  });
  if (!formulario || !formulario.ativo) {
    return NextResponse.json({ erro: "formulário não encontrado" }, { status: 404 });
  }

  const mapaPerguntas = new Map(formulario.perguntas.map((p) => [p.id, p]));

  // Só aceita respostas para perguntas que de fato pertencem a este
  // formulário — qualquer perguntaId estranho é descartado silenciosamente.
  const respostasValidas: { perguntaId: string; valor: string; rotuloSnapshot: string }[] = [];
  for (const r of payload.respostas) {
    if (!r || typeof r.perguntaId !== "string" || typeof r.valor !== "string") continue;
    const pergunta = mapaPerguntas.get(r.perguntaId);
    if (!pergunta) continue;
    const valor = r.valor.trim();
    if (!valor) continue;
    respostasValidas.push({ perguntaId: r.perguntaId, valor, rotuloSnapshot: pergunta.rotulo });
  }

  // Validação no servidor — nunca confia no cliente. Mesma lógica de
  // validacaoPorTipo usada no wizard (src/lib/formularioPublico.ts), rodada
  // de novo aqui contra o valor de fato recebido.
  for (const r of respostasValidas) {
    const pergunta = mapaPerguntas.get(r.perguntaId)!;
    const erroTipo = validarValorPorTipo(pergunta.tipo, r.valor);
    if (erroTipo) {
      return NextResponse.json({ erro: `resposta inválida: ${pergunta.rotulo}` }, { status: 400 });
    }
  }

  const respondidas = new Set(respostasValidas.map((r) => r.perguntaId));
  const faltandoObrigatoria = formulario.perguntas.some(
    (p) => p.ativa && p.obrigatoria && !respondidas.has(p.id)
  );
  if (faltandoObrigatoria) {
    return NextResponse.json({ erro: "campos obrigatórios não preenchidos" }, { status: 400 });
  }

  const userAgent = req.headers.get("user-agent");

  // Gravação atômica: EnvioFormulario + RespostaFormulario num único create
  // aninhado (Prisma executa como transação implícita). O envio é
  // preservado sempre, mesmo que os dados sejam incompletos além do exigido
  // aqui — nenhum Paciente é criado ou consultado nesta fase (F2).
  await prisma.envioFormulario.create({
    data: {
      clinicaId: clinica.id,
      formularioId: formulario.id,
      status: "PENDENTE",
      consentimentoAceito: true,
      textoConsentimentoSnapshot: formulario.textoConsentimento,
      consentimentoEm: new Date(),
      ipOrigem: ip,
      userAgent,
      respostas: {
        create: respostasValidas.map((r) => ({
          perguntaId: r.perguntaId,
          rotuloSnapshot: r.rotuloSnapshot,
          valor: r.valor,
        })),
      },
    },
  });

  return respostaGenerica();
}
