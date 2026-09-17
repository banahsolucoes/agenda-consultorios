import Link from "next/link";

// Página pública de Termos de Uso — sem login, mesmo motivo de
// /privacidade/page.tsx. Texto é um modelo inicial (ver aviso no rodapé),
// não substitui revisão jurídica antes do uso real.
export const metadata = {
  title: "Termos de Uso | Agenda Consultórios",
};

export default function TermosDeUsoPage() {
  return (
    <div className="min-h-screen bg-bg px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-2xl font-semibold text-fg">Agenda Consultórios</h1>
          <p className="mt-1 text-sm text-muted">Termos de Uso</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm sm:p-10">
          <p className="mb-8 text-sm text-muted">Última atualização: 17 de setembro de 2026</p>

          <div className="space-y-8 text-sm leading-relaxed text-fg">
            <section>
              <p>
                Estes Termos de Uso regem o acesso e o uso do sistema <strong>Agenda para Consultórios</strong>{" "}
                (disponível em <strong>agenda.banahdigital.com.br</strong>), desenvolvido e operado pela{" "}
                <strong>Banah Digital</strong>. Ao criar uma conta ou usar o sistema, a clínica e seus
                usuários concordam com os termos abaixo. Dúvidas podem ser encaminhadas para{" "}
                <a href="mailto:contato@banahdigital.com.br" className="text-gold hover:underline">
                  contato@banahdigital.com.br
                </a>.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">1. Descrição do serviço</h2>
              <p>
                O Agenda para Consultórios é um sistema de agendamento e gestão de consultórios: cadastro
                de pacientes, organização de sessões e pacotes de atendimento, controle de tarefas e, de
                forma opcional, integração com Google Calendar, Google Meet e Google Drive, e envio de
                mensagens via WhatsApp para pacientes.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">2. Acesso por convite</h2>
              <p>
                O cadastro de uma clínica nova no sistema só é possível mediante um convite de uso único,
                emitido pela Banah Digital para um e-mail específico. Não há cadastro aberto ao público em
                geral. O acesso adicional de outros membros da equipe de uma clínica já cadastrada é
                concedido pelo administrador da própria clínica, dentro do sistema.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">3. Responsabilidades da clínica</h2>
              <p className="mb-2">Ao usar o sistema, a clínica se compromete a:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Fornecer dados verdadeiros, completos e atualizados sobre si e sobre seus pacientes.</li>
                <li>
                  Observar o sigilo profissional aplicável à sua atividade em relação a todos os dados de
                  pacientes tratados através do sistema, inclusive dados de saúde.
                </li>
                <li>
                  Obter, quando exigido pela legislação aplicável, o consentimento ou outra base legal
                  adequada dos próprios pacientes para o cadastro e tratamento de seus dados no sistema.
                </li>
                <li>
                  Manter em sigilo as credenciais de acesso (e-mail e senha) de cada usuário, e ser
                  responsável por toda atividade realizada através da própria conta.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">4. Disponibilidade do serviço</h2>
              <p>
                O sistema é oferecido em regime de melhor esforço. A Banah Digital não garante
                disponibilidade contínua e ininterrupta, podendo ocorrer indisponibilidades temporárias
                para manutenção, atualização, ou por fatores fora de seu controle (incluindo
                indisponibilidade de serviços de terceiros como Supabase, Vercel ou Google).
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">5. Limitação de responsabilidade</h2>
              <p>
                Na máxima extensão permitida pela legislação aplicável, a Banah Digital não se
                responsabiliza por danos indiretos, lucros cessantes, perda de dados decorrente de uso
                indevido do sistema pela própria clínica, ou por decisões clínicas tomadas com base em
                informações registradas no sistema — a responsabilidade pelo conteúdo e pela exatidão dos
                dados cadastrados é da clínica que os insere.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">6. Gratuidade e encerramento</h2>
              <p>
                O serviço é fornecido gratuitamente às clínicas convidadas durante o período de convite/
                acesso concedido. A Banah Digital pode encerrar o acesso de uma clínica mediante aviso
                prévio razoável, inclusive em caso de descontinuação do serviço.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">7. Suspensão por uso indevido</h2>
              <p>
                A Banah Digital pode suspender ou encerrar, a qualquer momento e sem aviso prévio quando a
                gravidade justificar, o acesso de uma clínica ou usuário que utilize o sistema de forma
                indevida — incluindo violação destes Termos, tentativa de acesso não autorizado a dados de
                outras clínicas, ou uso que coloque em risco a segurança ou o funcionamento do sistema.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold text-fg">8. Foro</h2>
              <p>
                Fica eleito o foro da comarca de <strong>São Paulo/SP</strong> para dirimir quaisquer
                controvérsias decorrentes destes Termos, com renúncia a qualquer outro, por mais
                privilegiado que seja.
              </p>
            </section>

            <section className="border-t border-border pt-6">
              <p className="text-xs text-muted">
                <strong>Aviso:</strong> este texto é um modelo inicial, escrito para refletir o
                funcionamento real do sistema descrito acima, mas <strong>não foi revisado por um
                advogado</strong>. Recomenda-se validação jurídica antes de utilizá-lo como termos de uso
                definitivos.
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
