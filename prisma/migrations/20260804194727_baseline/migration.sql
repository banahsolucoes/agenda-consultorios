-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."DiaSemana" AS ENUM ('SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO', 'DOMINGO');

-- CreateEnum
CREATE TYPE "public"."FormaPagamento" AS ENUM ('PIX', 'CARTAO', 'BOLETO', 'DINHEIRO', 'TRANSFERENCIA');

-- CreateEnum
CREATE TYPE "public"."FormaRecebimentoComissao" AS ENUM ('ADIANTADO', 'POR_PARCELA');

-- CreateEnum
CREATE TYPE "public"."OrigemCadastro" AS ENUM ('MANUAL', 'FORMS');

-- CreateEnum
CREATE TYPE "public"."Papel" AS ENUM ('ADMIN', 'PROFISSIONAL', 'OPERADOR');

-- CreateEnum
CREATE TYPE "public"."PapelComissao" AS ENUM ('SELLER', 'CLOSER', 'PRODUTOR');

-- CreateEnum
CREATE TYPE "public"."StatusAssinatura" AS ENUM ('TRIAL', 'ATIVA', 'INADIMPLENTE', 'CANCELADA');

-- CreateEnum
CREATE TYPE "public"."StatusCliente" AS ENUM ('ATIVO', 'CANCELADO', 'FINALIZADO');

-- CreateEnum
CREATE TYPE "public"."StatusComissao" AS ENUM ('PENDENTE', 'PAGO', 'ESTORNADO');

-- CreateEnum
CREATE TYPE "public"."StatusContrato" AS ENUM ('ATIVO', 'CONCLUIDO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "public"."StatusEnvio" AS ENUM ('PENDENTE', 'PROCESSADO', 'IGNORADO', 'ERRO');

-- CreateEnum
CREATE TYPE "public"."StatusPacote" AS ENUM ('ATIVO', 'CANCELADO', 'FINALIZADO');

-- CreateEnum
CREATE TYPE "public"."StatusSessao" AS ENUM ('AGENDADA', 'REAGENDADA', 'REALIZADA', 'NAO_REALIZADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "public"."StatusSincronizacaoGoogle" AS ENUM ('NAO_APLICAVEL', 'PENDENTE', 'SINCRONIZADO', 'FALHOU');

-- CreateEnum
CREATE TYPE "public"."TarefaOrigem" AS ENUM ('SISTEMA', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."TarefaRecorrencia" AS ENUM ('NENHUMA', 'MENSAL');

-- CreateEnum
CREATE TYPE "public"."TarefaStatus" AS ENUM ('PENDENTE', 'CONCLUIDA', 'ARQUIVADA');

-- CreateEnum
CREATE TYPE "public"."TarefaTipo" AS ENUM ('RENOVACAO', 'CONTA');

-- CreateEnum
CREATE TYPE "public"."TipoPacote" AS ENUM ('AVULSA', 'MENSAL', 'BIMESTRAL', 'TRIMESTRAL', 'PERSONALIZADO');

-- CreateEnum
CREATE TYPE "public"."TipoPergunta" AS ENUM ('TEXTO_CURTO', 'TEXTO_LONGO', 'SIM_NAO', 'MULTIPLA_ESCOLHA', 'DATA', 'EMAIL', 'TELEFONE', 'CPF', 'CEP');

-- CreateTable
CREATE TABLE "public"."Agendamento" (
    "id" TEXT NOT NULL,
    "pacoteId" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "numeroSessao" INTEGER NOT NULL,
    "totalPacote" INTEGER NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "duracaoMin" INTEGER NOT NULL DEFAULT 45,
    "status" "public"."StatusSessao" NOT NULL DEFAULT 'AGENDADA',
    "googleEventId" TEXT,
    "googleCalendarId" TEXT,
    "linkMeet" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tipoSessaoId" TEXT,
    "motivoCancelamento" TEXT,
    "confirmada" BOOLEAN NOT NULL DEFAULT false,
    "arquivada" BOOLEAN NOT NULL DEFAULT false,
    "googleSyncStatus" "public"."StatusSincronizacaoGoogle" NOT NULL DEFAULT 'NAO_APLICAVEL',
    "lembreteWhatsappEnviadoEm" TIMESTAMP(3),

    CONSTRAINT "Agendamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Anexo" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "nomeArquivo" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Anexo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Clinica" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "corPrimaria" TEXT,
    "corSecundaria" TEXT,
    "duracaoPadraoMin" INTEGER NOT NULL DEFAULT 45,
    "horarioLimiteConfirmacao" TEXT NOT NULL DEFAULT '17:00',
    "logo" TEXT,
    "nomeAssistente" TEXT NOT NULL DEFAULT 'Assistente',
    "googleAccessToken" TEXT,
    "googleCalendarId" TEXT DEFAULT 'primary',
    "googleConectado" BOOLEAN NOT NULL DEFAULT false,
    "googleRefreshToken" TEXT,
    "googleTokenExpiry" TIMESTAMP(3),
    "pastaRaizDriveId" TEXT,
    "emailBoasVindasAssunto" TEXT NOT NULL DEFAULT 'Acesso a Gravações com a Fono Pâmela Rachid',
    "emailBoasVindasCorpo" TEXT NOT NULL DEFAULT 'Olá {nome}, tudo bem?

Suas sessões ficam gravadas e disponíveis através do acesso por esse e-mail. É só clicar e acionar seu conteúdo.

{link_pasta}

Vale muito a pena ir praticando durante a semana, nos intervalos do dia mesmo… no banho, arrumando a casa, caminhando. Esses pequenos momentos fazem diferença de verdade no seu resultado.

Qualquer dúvida, me chama 😊

Atenciosamente
Fono Pâmela Rachid',
    "googleEscopos" TEXT,
    "fundoOpacidade" INTEGER NOT NULL DEFAULT 100,
    "fundoUrl" TEXT,
    "fundoAjuste" TEXT NOT NULL DEFAULT 'cover',
    "nomeExibicao" TEXT,
    "templateConfirmacao" TEXT NOT NULL DEFAULT '{saudacao} {paciente}, tudo bem?! 
🌸 Passando para confirmar sua sessão no dia {data} às {hora}hr. 🗓
👉 Podemos confirmar? ✅
⸻
⚠️ Importante
Caso não haja confirmação até hoje, às {horarioLimite}hr, o horário será automaticamente cancelado.
Um abraço

{assistente} 🥰',
    "templateMeet" TEXT NOT NULL DEFAULT '{saudacao} {paciente}, tudo bem? ☀️

Segue o link da sua sessão de hoje às {hora}h.
🔗 {linkMeet} 🔗

Qualquer coisa, estou por aqui.

{assistente} 🥰',
    "permitirResizeSessao" BOOLEAN NOT NULL DEFAULT false,
    "sheetsPlanilhaId" TEXT,
    "sheetsAba" TEXT DEFAULT 'Página1',
    "razaoSocial" TEXT,
    "cnpj" TEXT,
    "enderecoLogradouro" TEXT,
    "enderecoNumero" TEXT,
    "enderecoComplemento" TEXT,
    "enderecoBairro" TEXT,
    "enderecoCidade" TEXT,
    "enderecoUF" TEXT,
    "cep" TEXT,
    "emailContato" TEXT,
    "telefoneContato" TEXT,
    "mentoriaAtivada" BOOLEAN NOT NULL DEFAULT false,
    "assinaturaAtualizadaEm" TIMESTAMP(3),
    "mpPayerEmail" TEXT,
    "mpPreapprovalId" TEXT,
    "statusAssinatura" "public"."StatusAssinatura" NOT NULL DEFAULT 'TRIAL',
    "trialFim" TIMESTAMP(3),
    "googleTokenValido" BOOLEAN NOT NULL DEFAULT true,
    "googleUltimaFalhaEm" TIMESTAMP(3),

    CONSTRAINT "Clinica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Comissionado" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT,
    "telefone" TEXT,
    "papelPadrao" "public"."PapelComissao",
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "formaRecebimento" "public"."FormaRecebimentoComissao" NOT NULL DEFAULT 'POR_PARCELA',
    "percentualComissao" DECIMAL(5,4),

    CONSTRAINT "Comissionado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Consentimento" (
    "id" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "versaoTermo" TEXT NOT NULL,
    "finalidade" TEXT NOT NULL,
    "aceitoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consentimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ConversaWhatsapp" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "pacienteId" TEXT,
    "telefone" TEXT NOT NULL,
    "janelaAbertaAte" TIMESTAMP(3),
    "estado" TEXT NOT NULL DEFAULT 'aberta',
    "ultimaMensagemEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversaWhatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EnvioFormulario" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "formularioId" TEXT NOT NULL,
    "pacienteId" TEXT,
    "status" "public"."StatusEnvio" NOT NULL DEFAULT 'PENDENTE',
    "consentimentoAceito" BOOLEAN NOT NULL,
    "textoConsentimentoSnapshot" TEXT NOT NULL,
    "consentimentoEm" TIMESTAMP(3) NOT NULL,
    "ipOrigem" TEXT,
    "userAgent" TEXT,
    "observacaoProcessamento" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvioFormulario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FormularioAnamnese" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "textoConsentimento" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormularioAnamnese_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HorarioTrabalho" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "diaSemana" "public"."DiaSemana" NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFim" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HorarioTrabalho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LogAuditoria" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "usuarioId" TEXT,
    "acao" TEXT NOT NULL,
    "detalhe" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogAuditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MensagemWhatsapp" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "direcao" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "respondidaPorIa" BOOLEAN NOT NULL DEFAULT false,
    "wamid" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MensagemWhatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MentoriaAluno" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "nomeCompleto" TEXT NOT NULL,
    "cpf" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "observacoes" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "aceiteTermos" BOOLEAN,
    "aceiteTermosTexto" TEXT,
    "cep" TEXT,
    "cidadeUf" TEXT,
    "dataNascimento" TIMESTAMP(3),
    "enderecoCompleto" TEXT,
    "estadoCivil" TEXT,
    "nacionalidade" TEXT,
    "profissao" TEXT,
    "rg" TEXT,
    "submissionData" TIMESTAMP(3),
    "submissionId" TEXT,
    "submitter" TEXT,

    CONSTRAINT "MentoriaAluno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MentoriaComissao" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "comissionadoId" TEXT NOT NULL,
    "papel" "public"."PapelComissao" NOT NULL,
    "percentual" DECIMAL(5,4) NOT NULL,
    "status" "public"."StatusComissao" NOT NULL DEFAULT 'PENDENTE',
    "dataPagamento" TIMESTAMP(3),
    "estornoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "formaRecebimento" "public"."FormaRecebimentoComissao" NOT NULL DEFAULT 'POR_PARCELA',

    CONSTRAINT "MentoriaComissao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MentoriaContrato" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "alunoId" TEXT NOT NULL,
    "pacote" TEXT NOT NULL,
    "valorTotal" DECIMAL(10,2) NOT NULL,
    "taxaImpostoPct" DECIMAL(5,4) NOT NULL DEFAULT 0.06,
    "assinaturaContrato" TIMESTAMP(3) NOT NULL,
    "totalParcelas" INTEGER NOT NULL,
    "status" "public"."StatusContrato" NOT NULL DEFAULT 'ATIVO',
    "canceladoEm" TIMESTAMP(3),
    "motivoCancelamento" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "duracaoMeses" INTEGER NOT NULL,

    CONSTRAINT "MentoriaContrato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MentoriaParcela" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "valorBruto" DECIMAL(10,2) NOT NULL,
    "valorLiquido" DECIMAL(10,2),
    "vencimento" TIMESTAMP(3) NOT NULL,
    "dataPagamento" TIMESTAMP(3),
    "formaPagamento" "public"."FormaPagamento",
    "estornoEm" TIMESTAMP(3),
    "valorEstornado" DECIMAL(10,2),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MentoriaParcela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Paciente" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT,
    "email" TEXT,
    "diaPreferido" "public"."DiaSemana",
    "horarioFixo" TEXT,
    "tipoSessaoLegado" TEXT,
    "statusGeral" "public"."StatusCliente" NOT NULL DEFAULT 'ATIVO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bairro" TEXT,
    "cep" TEXT,
    "cidade" TEXT,
    "complemento" TEXT,
    "cpf" TEXT,
    "estado" TEXT,
    "logradouro" TEXT,
    "numero" TEXT,
    "origemCadastro" "public"."OrigemCadastro" NOT NULL DEFAULT 'MANUAL',
    "quemIndicou" TEXT,
    "tipoSessaoId" TEXT,
    "finalizadoEm" TIMESTAMP(3),
    "pastaDriveUrl" TEXT,
    "dataNascimento" TEXT,
    "estadoCivil" TEXT,
    "nacionalidade" TEXT,
    "instagram" TEXT,
    "profissao" TEXT,
    "rg" TEXT,
    "dataCadastroForms" TIMESTAMP(3),
    "anamnese" TEXT,

    CONSTRAINT "Paciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Pacote" (
    "id" TEXT NOT NULL,
    "pacienteId" TEXT NOT NULL,
    "tipo" "public"."TipoPacote" NOT NULL,
    "totalSessoes" INTEGER NOT NULL,
    "dataInicial" TIMESTAMP(3) NOT NULL,
    "status" "public"."StatusPacote" NOT NULL DEFAULT 'ATIVO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pacote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PerguntaFormulario" (
    "id" TEXT NOT NULL,
    "formularioId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "rotulo" TEXT NOT NULL,
    "descricao" TEXT,
    "tipo" "public"."TipoPergunta" NOT NULL,
    "obrigatoria" BOOLEAN NOT NULL DEFAULT false,
    "opcoes" TEXT[],
    "campoPaciente" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerguntaFormulario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RespostaFormulario" (
    "id" TEXT NOT NULL,
    "envioId" TEXT NOT NULL,
    "perguntaId" TEXT NOT NULL,
    "rotuloSnapshot" TEXT NOT NULL,
    "valor" TEXT NOT NULL,

    CONSTRAINT "RespostaFormulario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Tarefa" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "tipo" "public"."TarefaTipo" NOT NULL,
    "origem" "public"."TarefaOrigem" NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "pacienteId" TEXT,
    "dataVencimento" TIMESTAMP(3),
    "dataAviso" TIMESTAMP(3),
    "recorrencia" "public"."TarefaRecorrencia" NOT NULL DEFAULT 'NENHUMA',
    "status" "public"."TarefaStatus" NOT NULL DEFAULT 'PENDENTE',
    "criadoPor" TEXT,
    "concluidoPor" TEXT,
    "concluidoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tarefa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TipoSessao" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cor" TEXT,
    "duracaoPadraoMin" INTEGER NOT NULL DEFAULT 45,
    "ehOnline" BOOLEAN NOT NULL DEFAULT false,
    "valor" DECIMAL(65,30),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ehAtendimentoUnico" BOOLEAN NOT NULL DEFAULT false,
    "googleCalendarId" TEXT,

    CONSTRAINT "TipoSessao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Usuario" (
    "id" TEXT NOT NULL,
    "clinicaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "papel" "public"."Papel" NOT NULL DEFAULT 'OPERADOR',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Agendamento_inicio_idx" ON "public"."Agendamento"("inicio" ASC);

-- CreateIndex
CREATE INDEX "Agendamento_pacienteId_idx" ON "public"."Agendamento"("pacienteId" ASC);

-- CreateIndex
CREATE INDEX "Agendamento_tipoSessaoId_idx" ON "public"."Agendamento"("tipoSessaoId" ASC);

-- CreateIndex
CREATE INDEX "Anexo_clinicaId_idx" ON "public"."Anexo"("clinicaId" ASC);

-- CreateIndex
CREATE INDEX "Anexo_pacienteId_idx" ON "public"."Anexo"("pacienteId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Clinica_slug_key" ON "public"."Clinica"("slug" ASC);

-- CreateIndex
CREATE INDEX "Comissionado_clinicaId_idx" ON "public"."Comissionado"("clinicaId" ASC);

-- CreateIndex
CREATE INDEX "Consentimento_pacienteId_idx" ON "public"."Consentimento"("pacienteId" ASC);

-- CreateIndex
CREATE INDEX "ConversaWhatsapp_clinicaId_idx" ON "public"."ConversaWhatsapp"("clinicaId" ASC);

-- CreateIndex
CREATE INDEX "ConversaWhatsapp_clinicaId_telefone_idx" ON "public"."ConversaWhatsapp"("clinicaId" ASC, "telefone" ASC);

-- CreateIndex
CREATE INDEX "ConversaWhatsapp_pacienteId_idx" ON "public"."ConversaWhatsapp"("pacienteId" ASC);

-- CreateIndex
CREATE INDEX "EnvioFormulario_clinicaId_idx" ON "public"."EnvioFormulario"("clinicaId" ASC);

-- CreateIndex
CREATE INDEX "EnvioFormulario_formularioId_idx" ON "public"."EnvioFormulario"("formularioId" ASC);

-- CreateIndex
CREATE INDEX "EnvioFormulario_pacienteId_idx" ON "public"."EnvioFormulario"("pacienteId" ASC);

-- CreateIndex
CREATE INDEX "FormularioAnamnese_clinicaId_idx" ON "public"."FormularioAnamnese"("clinicaId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "FormularioAnamnese_clinicaId_slug_key" ON "public"."FormularioAnamnese"("clinicaId" ASC, "slug" ASC);

-- CreateIndex
CREATE INDEX "HorarioTrabalho_clinicaId_idx" ON "public"."HorarioTrabalho"("clinicaId" ASC);

-- CreateIndex
CREATE INDEX "LogAuditoria_clinicaId_idx" ON "public"."LogAuditoria"("clinicaId" ASC);

-- CreateIndex
CREATE INDEX "MensagemWhatsapp_conversaId_idx" ON "public"."MensagemWhatsapp"("conversaId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MensagemWhatsapp_wamid_key" ON "public"."MensagemWhatsapp"("wamid" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MentoriaAluno_clinicaId_cpf_key" ON "public"."MentoriaAluno"("clinicaId" ASC, "cpf" ASC);

-- CreateIndex
CREATE INDEX "MentoriaAluno_clinicaId_idx" ON "public"."MentoriaAluno"("clinicaId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MentoriaAluno_clinicaId_submissionId_key" ON "public"."MentoriaAluno"("clinicaId" ASC, "submissionId" ASC);

-- CreateIndex
CREATE INDEX "MentoriaComissao_clinicaId_idx" ON "public"."MentoriaComissao"("clinicaId" ASC);

-- CreateIndex
CREATE INDEX "MentoriaComissao_comissionadoId_idx" ON "public"."MentoriaComissao"("comissionadoId" ASC);

-- CreateIndex
CREATE INDEX "MentoriaComissao_contratoId_idx" ON "public"."MentoriaComissao"("contratoId" ASC);

-- CreateIndex
CREATE INDEX "MentoriaContrato_alunoId_idx" ON "public"."MentoriaContrato"("alunoId" ASC);

-- CreateIndex
CREATE INDEX "MentoriaContrato_clinicaId_idx" ON "public"."MentoriaContrato"("clinicaId" ASC);

-- CreateIndex
CREATE INDEX "MentoriaParcela_clinicaId_dataPagamento_idx" ON "public"."MentoriaParcela"("clinicaId" ASC, "dataPagamento" ASC);

-- CreateIndex
CREATE INDEX "MentoriaParcela_clinicaId_idx" ON "public"."MentoriaParcela"("clinicaId" ASC);

-- CreateIndex
CREATE INDEX "MentoriaParcela_clinicaId_vencimento_idx" ON "public"."MentoriaParcela"("clinicaId" ASC, "vencimento" ASC);

-- CreateIndex
CREATE INDEX "MentoriaParcela_contratoId_idx" ON "public"."MentoriaParcela"("contratoId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Paciente_clinicaId_cpf_key" ON "public"."Paciente"("clinicaId" ASC, "cpf" ASC);

-- CreateIndex
CREATE INDEX "Paciente_clinicaId_idx" ON "public"."Paciente"("clinicaId" ASC);

-- CreateIndex
CREATE INDEX "Paciente_tipoSessaoId_idx" ON "public"."Paciente"("tipoSessaoId" ASC);

-- CreateIndex
CREATE INDEX "Pacote_pacienteId_idx" ON "public"."Pacote"("pacienteId" ASC);

-- CreateIndex
CREATE INDEX "PerguntaFormulario_formularioId_idx" ON "public"."PerguntaFormulario"("formularioId" ASC);

-- CreateIndex
CREATE INDEX "PerguntaFormulario_formularioId_ordem_idx" ON "public"."PerguntaFormulario"("formularioId" ASC, "ordem" ASC);

-- CreateIndex
CREATE INDEX "RespostaFormulario_envioId_idx" ON "public"."RespostaFormulario"("envioId" ASC);

-- CreateIndex
CREATE INDEX "RespostaFormulario_perguntaId_idx" ON "public"."RespostaFormulario"("perguntaId" ASC);

-- CreateIndex
CREATE INDEX "Tarefa_clinicaId_status_idx" ON "public"."Tarefa"("clinicaId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "Tarefa_pacienteId_idx" ON "public"."Tarefa"("pacienteId" ASC);

-- CreateIndex
CREATE INDEX "TipoSessao_clinicaId_idx" ON "public"."TipoSessao"("clinicaId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "public"."Usuario"("email" ASC);

-- AddForeignKey
ALTER TABLE "public"."Agendamento" ADD CONSTRAINT "Agendamento_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "public"."Paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Agendamento" ADD CONSTRAINT "Agendamento_pacoteId_fkey" FOREIGN KEY ("pacoteId") REFERENCES "public"."Pacote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Agendamento" ADD CONSTRAINT "Agendamento_tipoSessaoId_fkey" FOREIGN KEY ("tipoSessaoId") REFERENCES "public"."TipoSessao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Anexo" ADD CONSTRAINT "Anexo_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "public"."Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Anexo" ADD CONSTRAINT "Anexo_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "public"."Paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Comissionado" ADD CONSTRAINT "Comissionado_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "public"."Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Consentimento" ADD CONSTRAINT "Consentimento_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "public"."Paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ConversaWhatsapp" ADD CONSTRAINT "ConversaWhatsapp_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "public"."Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ConversaWhatsapp" ADD CONSTRAINT "ConversaWhatsapp_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "public"."Paciente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EnvioFormulario" ADD CONSTRAINT "EnvioFormulario_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "public"."Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EnvioFormulario" ADD CONSTRAINT "EnvioFormulario_formularioId_fkey" FOREIGN KEY ("formularioId") REFERENCES "public"."FormularioAnamnese"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EnvioFormulario" ADD CONSTRAINT "EnvioFormulario_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "public"."Paciente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FormularioAnamnese" ADD CONSTRAINT "FormularioAnamnese_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "public"."Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HorarioTrabalho" ADD CONSTRAINT "HorarioTrabalho_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "public"."Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LogAuditoria" ADD CONSTRAINT "LogAuditoria_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "public"."Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LogAuditoria" ADD CONSTRAINT "LogAuditoria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "public"."Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MensagemWhatsapp" ADD CONSTRAINT "MensagemWhatsapp_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "public"."ConversaWhatsapp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MentoriaAluno" ADD CONSTRAINT "MentoriaAluno_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "public"."Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MentoriaComissao" ADD CONSTRAINT "MentoriaComissao_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "public"."Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MentoriaComissao" ADD CONSTRAINT "MentoriaComissao_comissionadoId_fkey" FOREIGN KEY ("comissionadoId") REFERENCES "public"."Comissionado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MentoriaComissao" ADD CONSTRAINT "MentoriaComissao_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "public"."MentoriaContrato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MentoriaContrato" ADD CONSTRAINT "MentoriaContrato_alunoId_fkey" FOREIGN KEY ("alunoId") REFERENCES "public"."MentoriaAluno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MentoriaContrato" ADD CONSTRAINT "MentoriaContrato_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "public"."Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MentoriaParcela" ADD CONSTRAINT "MentoriaParcela_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "public"."Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MentoriaParcela" ADD CONSTRAINT "MentoriaParcela_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "public"."MentoriaContrato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Paciente" ADD CONSTRAINT "Paciente_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "public"."Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Paciente" ADD CONSTRAINT "Paciente_tipoSessaoId_fkey" FOREIGN KEY ("tipoSessaoId") REFERENCES "public"."TipoSessao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Pacote" ADD CONSTRAINT "Pacote_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "public"."Paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PerguntaFormulario" ADD CONSTRAINT "PerguntaFormulario_formularioId_fkey" FOREIGN KEY ("formularioId") REFERENCES "public"."FormularioAnamnese"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RespostaFormulario" ADD CONSTRAINT "RespostaFormulario_envioId_fkey" FOREIGN KEY ("envioId") REFERENCES "public"."EnvioFormulario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RespostaFormulario" ADD CONSTRAINT "RespostaFormulario_perguntaId_fkey" FOREIGN KEY ("perguntaId") REFERENCES "public"."PerguntaFormulario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Tarefa" ADD CONSTRAINT "Tarefa_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "public"."Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Tarefa" ADD CONSTRAINT "Tarefa_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "public"."Paciente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TipoSessao" ADD CONSTRAINT "TipoSessao_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "public"."Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Usuario" ADD CONSTRAINT "Usuario_clinicaId_fkey" FOREIGN KEY ("clinicaId") REFERENCES "public"."Clinica"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

