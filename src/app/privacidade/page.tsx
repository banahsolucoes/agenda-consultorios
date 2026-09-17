import Link from "next/link";

// Página pública de Política de Privacidade — sem login, exigida pelo fluxo
// de consentimento OAuth do Google (Calendar/Drive/Meet) e pelo checkbox de
// aceite em /cadastro. Texto é um modelo inicial (ver aviso no rodapé da
// própria página) — não substitui revisão jurídica antes do uso real.
export const metadata = {
  title: "Política de Privacidade | Agenda Consultórios",
};

export default function PoliticaPrivacidadePage() {
  return (
    <div className="min-h-screen bg-bg px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-2xl font-semibold text-fg">Agenda Consultórios</h1>
          <p className="mt-1 text-sm text-muted">Política de Privacidade</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm sm:p-10">
          <p className="mb-8 text-sm text-muted">Última atualização: 17 de setembro de 2026</p>

          <div className="space-y-8 text-sm leading-relaxed text-fg">
            <section>
              <p>
                Esta Política de Privacidade explica como o sistema <strong>Agenda para Consultórios</strong>{" "}
                (disponível em <strong>agenda.banahdigital.com.br</strong>), desenvolvido e operado pela{" "}
                <strong>Banah Digital</strong>, trata dados pessoais no âmbito do serviço de agendamento e
                gestão de consultórios oferecido a clínicas convidadas.
              </p>
              <p className="mt-3">
                Em caso de dúvidas ou solicitações relacionadas a esta política, entre em contato pelo
                e-mail <a href="mailto:contato@banahdigital.com.br" className="text-gold hover:underline">
                  contato@banahdigital.com.br
                </a>.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">1. Quais dados são coletados</h2>
              <p className="mb-2">Coletamos e tratamos três categorias de dados pessoais:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <strong>Dados da clínica:</strong> razão social, CNPJ, endereço, e-mail e telefone de
                  contato, dados fiscais e de identidade visual (logo, cores).
                </li>
                <li>
                  <strong>Dados da profissional/equipe (usuários do sistema):</strong> nome, e-mail e senha
                  de acesso (armazenada de forma criptografada), papel de acesso (administrador,
                  profissional ou operador), e registros de auditoria de uso do sistema.
                </li>
                <li>
                  <strong>Dados dos pacientes da clínica:</strong> nome, telefone, e-mail, CPF, endereço,
                  data de nascimento e outros dados cadastrais informados pela clínica, além de{" "}
                  <strong>dados sensíveis de saúde</strong> quando aplicável (anamnese, anotações clínicas,
                  histórico de sessões/atendimentos, e gravações de sessões quando a própria clínica optar
                  por compartilhá-las através da integração com o Google Drive).
                </li>
              </ul>
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">2. Finalidade do tratamento</h2>
              <p>
                Os dados são tratados exclusivamente para viabilizar o agendamento e a gestão do
                consultório: cadastro de pacientes, criação e acompanhamento de sessões/atendimentos,
                comunicação com pacientes (confirmação de horários, lembretes), geração de documentos e
                relatórios de uso interno da clínica, e suporte técnico ao funcionamento do sistema.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">3. Base legal (LGPD)</h2>
              <p>
                O tratamento de dados pessoais neste sistema se apoia nas seguintes bases legais da Lei
                Geral de Proteção de Dados (Lei nº 13.709/2018):
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  <strong>Execução de contrato</strong> — dados da clínica e da equipe, necessários para a
                  prestação do serviço contratado.
                </li>
                <li>
                  <strong>Tutela da saúde</strong> e <strong>execução de contrato entre a clínica e o
                  paciente</strong> — dados de saúde e demais dados dos pacientes, tratados pela clínica com
                  o apoio técnico deste sistema.
                </li>
                <li>
                  <strong>Legítimo interesse</strong> — registros de auditoria e segurança, limitados ao
                  necessário para proteger a operação e os próprios titulares dos dados.
                </li>
              </ul>
              <p className="mt-2">
                É responsabilidade de cada clínica garantir a base legal adequada perante os próprios
                pacientes (ex.: consentimento, quando exigido) para o cadastro dos dados desses pacientes
                no sistema — ver também os Termos de Uso.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">4. Papéis: controladora e operadora</h2>
              <p>
                Em relação aos dados dos pacientes, <strong>a clínica é a controladora</strong> dos dados —
                é ela quem decide quais pacientes cadastrar, quais dados coletar e como usá-los no dia a
                dia do consultório. A <strong>Banah Digital atua como operadora</strong>, tratando esses
                dados exclusivamente em nome e sob instrução de cada clínica, através do sistema, sem
                finalidade própria sobre os dados dos pacientes.
              </p>
              <p className="mt-2">
                Já em relação aos dados da própria clínica e da sua equipe (cadastro, acesso ao sistema,
                dados de cobrança), a Banah Digital atua como controladora.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">5. Integração com o Google (Calendar, Drive e Meet)</h2>
              <p>
                Cada clínica pode, de forma opcional, conectar sua própria conta do Google Workspace para
                sincronizar a agenda. Essa integração usa os seguintes escopos de acesso, concedidos pela
                clínica no momento da conexão:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li><strong>Google Calendar</strong> — criar, atualizar e remover eventos correspondentes às sessões agendadas.</li>
                <li><strong>Google Meet</strong> — gerar automaticamente o link de videochamada de sessões online.</li>
                <li><strong>Google Drive</strong> — criar pastas por paciente e, quando a clínica optar, compartilhar o acesso a gravações de sessão diretamente com o paciente.</li>
              </ul>
              <p className="mt-3">
                Os dados acessados através dessas integrações são usados <strong>exclusivamente para operar
                a agenda da própria clínica</strong> que autorizou o acesso — nunca são compartilhados com
                outras clínicas, vendidos a terceiros, ou usados para treinar modelos de inteligência
                artificial. O uso dessas integrações segue a{" "}
                <a
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gold hover:underline"
                >
                  Política de Dados do Usuário dos Serviços de API do Google
                </a>
                , incluindo os requisitos de Uso Limitado.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">6. Subprocessadores</h2>
              <p className="mb-2">
                Para operar o sistema, a Banah Digital utiliza os seguintes prestadores de serviço
                (subprocessadores), que podem ter acesso técnico aos dados na medida necessária à
                prestação do serviço contratado por eles:
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li><strong>Supabase</strong> — banco de dados, autenticação e armazenamento de arquivos (anexos, identidade visual).</li>
                <li><strong>Vercel</strong> — hospedagem da aplicação e execução das rotinas automáticas do sistema.</li>
                <li><strong>Google</strong> — integrações opcionais de Calendar, Drive e Meet, quando a clínica conecta sua conta.</li>
                <li><strong>Meta (WhatsApp Cloud API)</strong> — envio e recebimento de mensagens de WhatsApp com pacientes, quando esse canal está habilitado.</li>
                <li><strong>Mercado Pago</strong> — processamento da assinatura/cobrança da clínica pelo uso do sistema.</li>
              </ul>
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">7. Armazenamento</h2>
              <p>
                Os dados são armazenados em banco de dados e serviços de armazenamento de arquivos
                gerenciados pelos subprocessadores listados acima, com controle de acesso por clínica —
                cada clínica só acessa os próprios dados e os dados dos próprios pacientes.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">8. Retenção</h2>
              <p>
                Os dados são mantidos enquanto a clínica utilizar o sistema. Após o encerramento do
                acesso de uma clínica, os dados podem ser mantidos por um período adicional razoável para
                fins de segurança jurídica, cumprimento de obrigação legal ou regulatória, ou a pedido da
                própria clínica, e então eliminados ou anonimizados.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">9. Direitos do titular</h2>
              <p className="mb-2">
                Nos termos da LGPD, o titular dos dados pode solicitar, a qualquer momento: confirmação da
                existência de tratamento, acesso aos dados, correção de dados incompletos ou desatualizados,
                anonimização, bloqueio ou eliminação de dados desnecessários, portabilidade, informação
                sobre compartilhamento, e revogação do consentimento, quando aplicável.
              </p>
              <p>
                Pacientes devem, preferencialmente, dirigir esses pedidos diretamente à clínica onde são
                atendidos (a controladora dos seus dados). Pedidos recebidos pela Banah Digital serão
                encaminhados à clínica responsável, ou atendidos diretamente quando a solicitação for sobre
                dados sob controle da própria Banah Digital.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">10. Cookies</h2>
              <p>
                O sistema utiliza cookies estritamente necessários para manter a sessão de login (via
                Supabase Auth) e o funcionamento básico da aplicação. Não utilizamos cookies de rastreamento
                publicitário ou de terceiros para fins de marketing.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">11. Como solicitar exclusão de dados</h2>
              <p>
                Para solicitar a exclusão dos seus dados, entre em contato pelo e-mail{" "}
                <a href="mailto:contato@banahdigital.com.br" className="text-gold hover:underline">
                  contato@banahdigital.com.br
                </a>{" "}
                informando se você é uma clínica usuária do sistema ou um paciente de uma clínica que o
                utiliza (neste caso, indique também o nome da clínica). Pedidos de pacientes serão
                encaminhados à clínica responsável quando aplicável.
              </p>
            </section>

            <section className="border-t border-border pt-6">
              <p className="text-xs text-muted">
                <strong>Aviso:</strong> este texto é um modelo inicial, escrito para refletir o
                funcionamento real do sistema descrito acima, mas <strong>não foi revisado por um
                advogado</strong>. Recomenda-se validação jurídica antes de utilizá-lo como política de
                privacidade definitiva.
              </p>
            </section>
          </div>
        </div>

        <div className="mt-6 text-center">
          <Link href="/login" className="text-sm text-muted hover:text-gold hover:underline">
            Voltar
          </Link>
        </div>
      </div>
    </div>
  );
}
