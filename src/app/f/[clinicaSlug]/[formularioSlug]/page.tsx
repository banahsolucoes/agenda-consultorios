import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import FormularioWizard from "./FormularioWizard";

// Rota pública (sem autenticação) — o link é enviado por WhatsApp/e-mail
// pela clínica para o paciente preencher a anamnese antes da avaliação.
// clinicaId é derivado EXCLUSIVAMENTE do slug da URL (nunca aceito do
// cliente); qualquer combinação de slug inexistente ou formulário inativo
// cai no mesmo 404 genérico — nunca revela se a clínica existe.
export default async function FormularioPublicoPage({
  params,
}: {
  params: Promise<{ clinicaSlug: string; formularioSlug: string }>;
}) {
  const { clinicaSlug, formularioSlug } = await params;

  const clinica = await prisma.clinica.findUnique({
    where: { slug: clinicaSlug },
    select: { id: true, nome: true },
  });
  if (!clinica) notFound();

  const formulario = await prisma.formularioAnamnese.findUnique({
    where: { clinicaId_slug: { clinicaId: clinica.id, slug: formularioSlug } },
    select: {
      id: true,
      slug: true,
      titulo: true,
      descricao: true,
      textoConsentimento: true,
      ativo: true,
      perguntas: {
        where: { ativa: true },
        orderBy: { ordem: "asc" },
        select: {
          id: true,
          ordem: true,
          rotulo: true,
          descricao: true,
          tipo: true,
          obrigatoria: true,
          opcoes: true,
          campoPaciente: true,
        },
      },
    },
  });

  if (!formulario || !formulario.ativo) notFound();

  return (
    <FormularioWizard
      clinicaSlug={clinicaSlug}
      clinicaNome={clinica.nome}
      formularioSlug={formulario.slug}
      formularioTitulo={formulario.titulo}
      formularioDescricao={formulario.descricao}
      textoConsentimento={formulario.textoConsentimento}
      perguntas={formulario.perguntas}
    />
  );
}
