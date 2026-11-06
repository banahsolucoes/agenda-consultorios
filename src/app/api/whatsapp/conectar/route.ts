import { NextRequest, NextResponse } from "next/server";
import { getUsuarioLogado } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { registrarLog } from "@/lib/auditoria";
import { META_APP_ID, META_GRAPH_API_VERSION } from "@/lib/whatsapp/embeddedSignup";

// IDs da Meta (waba_id, phone_number_id) são sempre numéricos.
const ID_META = /^\d{5,30}$/;

// POST /api/whatsapp/conectar — fim do Embedded Signup (Coexistência) iniciado
// em /painel/whatsapp/conectar. Recebe { code, wabaId, phoneNumberId }, troca
// o code por access token e grava um CanalWhatsApp NOVO para a clínica do
// usuário logado, inativo e sem webhook.
//
// Deliberadamente NÃO faz:
// - POST /{phone_number_id}/register — número em Coexistência já está
//   registrado no app WhatsApp Business;
// - POST /{waba_id}/subscribed_apps — webhook fica desligado até o modo lead
//   ficar pronto;
// - nenhuma mudança no canal atual da agenda (env WHATSAPP_*) nem no webhook.
//
// O token nunca é logado nem devolvido na resposta.
export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(usuario.papel, "conectarWhatsapp")) {
    return NextResponse.json({ erro: "sem permissão para esta ação" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: "corpo da requisição inválido" }, { status: 400 });
  }
  const { code, wabaId, phoneNumberId } = (body ?? {}) as Record<string, unknown>;
  if (typeof code !== "string" || code.length === 0 || code.length > 4096) {
    return NextResponse.json({ erro: "code ausente ou inválido" }, { status: 400 });
  }
  if (typeof wabaId !== "string" || !ID_META.test(wabaId)) {
    return NextResponse.json({ erro: "waba_id ausente ou inválido" }, { status: 400 });
  }
  if (typeof phoneNumberId !== "string" || !ID_META.test(phoneNumberId)) {
    return NextResponse.json({ erro: "phone_number_id ausente ou inválido" }, { status: 400 });
  }

  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    console.error("[whatsapp/conectar] WHATSAPP_APP_SECRET não configurado");
    return NextResponse.json({ erro: "configuração do servidor incompleta" }, { status: 500 });
  }

  // Checado antes de gastar o code (uso único) — mensagem genérica de
  // propósito, sem dizer a qual clínica o número pertence.
  const existente = await prisma.canalWhatsApp.findUnique({
    where: { phoneNumberId },
    select: { id: true },
  });
  if (existente) {
    return NextResponse.json({ erro: "este número já está conectado" }, { status: 409 });
  }

  const urlToken = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/oauth/access_token`);
  urlToken.searchParams.set("client_id", META_APP_ID);
  urlToken.searchParams.set("client_secret", appSecret);
  urlToken.searchParams.set("code", code);

  let accessToken: string;
  try {
    const res = await fetch(urlToken, { method: "GET", cache: "no-store" });
    const dados = (await res.json().catch(() => null)) as
      | { access_token?: unknown; error?: { message?: string; code?: number; type?: string } }
      | null;
    if (!res.ok || typeof dados?.access_token !== "string" || !dados.access_token) {
      // Só status + campos de erro da Meta — nunca a URL (tem o secret) nem o corpo inteiro.
      console.error("[whatsapp/conectar] falha ao trocar code por token", {
        status: res.status,
        codigo: dados?.error?.code,
        tipo: dados?.error?.type,
        mensagem: dados?.error?.message,
      });
      const detalhe = dados?.error?.message ? `: ${dados.error.message}` : "";
      return NextResponse.json(
        { erro: `a Meta recusou a troca do código${detalhe}` },
        { status: 502 }
      );
    }
    accessToken = dados.access_token;
  } catch (err) {
    console.error("[whatsapp/conectar] erro de rede ao trocar code por token", (err as Error)?.message);
    return NextResponse.json({ erro: "não foi possível falar com a Meta, tente de novo" }, { status: 502 });
  }

  try {
    const canal = await prisma.canalWhatsApp.create({
      data: {
        clinicaId: usuario.clinicaId,
        wabaId,
        phoneNumberId,
        accessToken,
        ativo: false,
      },
      select: { id: true, wabaId: true, phoneNumberId: true, ativo: true },
    });

    await registrarLog(
      usuario.clinicaId,
      usuario.id,
      "CONECTAR_CANAL_WHATSAPP",
      `Embedded Signup (Coexistência): phone_number_id ${phoneNumberId}, waba_id ${wabaId} — canal criado inativo, sem webhook`
    );

    return NextResponse.json(canal, { status: 201 });
  } catch (err) {
    const codigo = (err as { code?: string } | null)?.code;
    if (codigo === "P2002") {
      return NextResponse.json({ erro: "este número já está conectado" }, { status: 409 });
    }
    // Só código/nome: a mensagem de erro do Prisma pode ecoar os argumentos
    // do create — incluindo o accessToken.
    console.error("[whatsapp/conectar] falha ao gravar CanalWhatsApp", codigo ?? (err as Error)?.name);
    return NextResponse.json({ erro: "falha ao salvar o canal" }, { status: 500 });
  }
}
