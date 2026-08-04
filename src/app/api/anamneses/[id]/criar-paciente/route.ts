import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { cpfMatematicamenteValido, soDigitosCpf } from "@/lib/cpf";
import { montarAnamneseDeRespostas } from "@/lib/importacao";
import { registrarLog } from "@/lib/auditoria";

// Campos do Paciente que este fluxo pode preencher — mesmo conjunto das 13
// perguntas cadastrais do seed (F1), menos os campos de endereço granular
// (numero/complemento/bairro/cidade/estado) que a planilha/formulário nunca
// coletou separadamente (só "Endereço Completo" -> logradouro).
const CAMPOS_ACEITOS = [
  "nome",
  "telefone",
  "email",
  "cpf",
  "rg",
  "logradouro",
  "cep",
  "quemIndicou",
  "dataNascimento",
  "estadoCivil",
  "nacionalidade",
  "profissao",
  "instagram",
] as const;

class ConflitoProcessamento extends Error {}

// POST /api/anamneses/[id]/criar-paciente — Ação A da fila (F2.5): cria um
// Paciente novo a partir de um EnvioFormulario PENDENTE, usando os valores
// que a Daiane confirmou/corrigiu no formulário (nunca os valores brutos do
// envio direto — quem chama já editou). Sem diaPreferido/horarioFixo/
// tipoSessaoId: isso é intake, o agendamento vem depois, num fluxo
// separado.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const camposPacienteEntrada = body?.camposPaciente;
  if (!camposPacienteEntrada || typeof camposPacienteEntrada !== "object") {
    return NextResponse.json({ erro: "camposPaciente é obrigatório" }, { status: 400 });
  }

  const nome = String(camposPacienteEntrada.nome ?? "").trim();
  if (!nome) {
    return NextResponse.json({ erro: "nome é obrigatório" }, { status: 400 });
  }

  const cpfBruto = String(camposPacienteEntrada.cpf ?? "").trim();
  const cpfDigitos = cpfBruto ? soDigitosCpf(cpfBruto) : "";
  if (cpfDigitos && !cpfMatematicamenteValido(cpfDigitos)) {
    return NextResponse.json({ erro: "CPF inválido" }, { status: 400 });
  }

  const dadosPaciente: Record<string, string | null> = { nome };
  for (const campo of CAMPOS_ACEITOS) {
    if (campo === "nome") continue;
    if (campo === "cpf") {
      dadosPaciente.cpf = cpfDigitos || null;
      continue;
    }
    const valor = camposPacienteEntrada[campo];
    dadosPaciente[campo] = typeof valor === "string" && valor.trim() ? valor.trim() : null;
  }

  const envio = await prisma.envioFormulario.findUnique({
    where: { id },
    select: {
      id: true,
      clinicaId: true,
      status: true,
      respostas: {
        select: { rotuloSnapshot: true, valor: true, pergunta: { select: { ordem: true } } },
      },
    },
  });
  if (!envio || envio.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "envio não encontrado" }, { status: 404 });
  }
  if (envio.status !== "PENDENTE") {
    return NextResponse.json({ erro: "este envio já foi processado" }, { status: 409 });
  }

  const respostasOrdenadas = [...envio.respostas].sort((a, b) => a.pergunta.ordem - b.pergunta.ordem);
  const anamneseTexto = montarAnamneseDeRespostas(respostasOrdenadas);

  try {
    const paciente = await prisma.$transaction(async (tx) => {
      // Guarda contra corrida: só avança se o envio ainda estava PENDENTE
      // no exato momento da escrita (o SELECT acima pode estar
      // desatualizado se duas abas processarem o mesmo envio ao mesmo
      // tempo).
      const guarda = await tx.envioFormulario.updateMany({
        where: { id: envio.id, status: "PENDENTE" },
        data: { status: "PROCESSADO" },
      });
      if (guarda.count !== 1) throw new ConflitoProcessamento();

      const novoPaciente = await tx.paciente.create({
        data: {
          clinicaId: usuario.clinicaId,
          nome: dadosPaciente.nome!,
          telefone: dadosPaciente.telefone,
          email: dadosPaciente.email,
          cpf: dadosPaciente.cpf,
          rg: dadosPaciente.rg,
          logradouro: dadosPaciente.logradouro,
          cep: dadosPaciente.cep,
          quemIndicou: dadosPaciente.quemIndicou,
          dataNascimento: dadosPaciente.dataNascimento,
          estadoCivil: dadosPaciente.estadoCivil,
          nacionalidade: dadosPaciente.nacionalidade,
          profissao: dadosPaciente.profissao,
          instagram: dadosPaciente.instagram,
          anamnese: anamneseTexto || null,
          origemCadastro: "FORMS",
        },
      });

      await tx.envioFormulario.update({
        where: { id: envio.id },
        data: { pacienteId: novoPaciente.id },
      });

      return novoPaciente;
    });

    await registrarLog(
      usuario.clinicaId,
      usuario.id,
      "CRIAR_PACIENTE_DE_ANAMNESE",
      `Criou o paciente ${paciente.nome} a partir do envio de anamnese ${envio.id}`
    );

    return NextResponse.json(paciente, { status: 201 });
  } catch (err) {
    if (err instanceof ConflitoProcessamento) {
      return NextResponse.json({ erro: "este envio já foi processado" }, { status: 409 });
    }
    const codigo = (err as { code?: string } | null)?.code;
    if (codigo === "P2002") {
      return NextResponse.json({ erro: "CPF já cadastrado nesta clínica" }, { status: 409 });
    }
    throw err;
  }
}
