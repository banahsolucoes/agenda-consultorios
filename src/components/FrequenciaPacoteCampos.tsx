"use client";

import { diaSemanaLabel } from "@/lib/labels";

// Mesma ordem do enum DiaSemana do Prisma (segunda = 0), igual ao DIA_OFFSET
// de POST /api/pacotes.
const DIAS_SEMANA = ["SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA", "SABADO", "DOMINGO"] as const;
const INTERVALO_MINIMO_DIAS = 2;

function mascararHorario(valor: string) {
  const digitos = valor.replace(/\D/g, "").slice(0, 4);
  return digitos.length > 2 ? `${digitos.slice(0, 2)}:${digitos.slice(2)}` : digitos;
}

// Validação D7 no front (a API valida de novo): o 2º dia precisa estar na
// mesma semana (segunda a domingo) da 1ª sessão e pelo menos 2 dias depois.
// `dataInicial` é "YYYY-MM-DD" (dia de calendário, sem fuso). Devolve a
// mensagem de erro ou null.
export function validarSlot2Pacote(dataInicial: string, diaSemana2: string, horario2: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataInicial);
  if (!m) return "informe o dia da 1ª sessão";
  if (!diaSemana2) return "informe o dia da 2ª sessão da semana";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(horario2)) return "informe o horário da 2ª sessão (HH:MM)";
  const diaSemanaJs = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  const offset1 = (diaSemanaJs + 6) % 7;
  const offset2 = DIAS_SEMANA.indexOf(diaSemana2 as (typeof DIAS_SEMANA)[number]);
  if (offset2 - offset1 < INTERVALO_MINIMO_DIAS) {
    return `o 2º dia precisa estar na mesma semana (segunda a domingo) da 1ª sessão e pelo menos ${INTERVALO_MINIMO_DIAS} dias depois dela`;
  }
  return null;
}

// Campos "Frequência: 1x / 2x por semana" + 2º dia/horário, usados pelos
// dois formulários de criar atendimento (painel/page.tsx e
// AgendaCalendario.tsx). Só UI — o estado fica em quem usa.
export default function FrequenciaPacoteCampos({
  frequencia,
  onFrequencia,
  diaSemana2,
  onDiaSemana2,
  horario2,
  onHorario2,
  desabilitado2x = false,
}: {
  frequencia: 1 | 2;
  onFrequencia: (f: 1 | 2) => void;
  diaSemana2: string;
  onDiaSemana2: (d: string) => void;
  horario2: string;
  onHorario2: (h: string) => void;
  // Ex.: atendimento único / Avulsa (1 sessão) — 2x não faz sentido.
  desabilitado2x?: boolean;
}) {
  // Com 2x desabilitado, mostra 1x mesmo que o estado ainda esteja em 2 —
  // quem usa envia a frequência efetiva com a mesma regra.
  const efetiva: 1 | 2 = desabilitado2x ? 1 : frequencia;
  const botao = (valor: 1 | 2, rotulo: string) => (
    <button
      type="button"
      onClick={() => onFrequencia(valor)}
      disabled={valor === 2 && desabilitado2x}
      className={`rounded-lg border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
        efetiva === valor ? "border-gold bg-gold/10 text-gold" : "border-border text-fg hover:bg-bg"
      }`}
    >
      {rotulo}
    </button>
  );

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-sm font-medium text-fg">Frequência</label>
        <div className="flex gap-2">
          {botao(1, "1x por semana")}
          {botao(2, "2x por semana")}
        </div>
      </div>
      {efetiva === 2 && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block whitespace-nowrap text-sm font-medium text-fg">2º dia da semana</label>
              <select
                value={diaSemana2}
                onChange={(e) => onDiaSemana2(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
              >
                <option value="">Selecione</option>
                {DIAS_SEMANA.map((dia) => (
                  <option key={dia} value={dia}>
                    {diaSemanaLabel(dia)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block whitespace-nowrap text-sm font-medium text-fg">2º horário</label>
              <input
                type="text"
                required
                placeholder="14:00"
                pattern="^([01]\d|2[0-3]):[0-5]\d$"
                value={horario2}
                onChange={(e) => onHorario2(mascararHorario(e.target.value))}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
              />
            </div>
          </div>
          <p className="text-xs text-muted">
            As sessões alternam entre o dia da 1ª sessão e o 2º dia, toda semana. O 2º dia precisa ser na mesma
            semana e pelo menos 2 dias depois (ex.: terça e quinta). O total de sessões não muda.
          </p>
        </>
      )}
    </div>
  );
}
