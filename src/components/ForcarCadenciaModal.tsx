"use client";

import { useCallback, useState } from "react";

// Mesmo mínimo de src/lib/excecaoCadencia.ts (MOTIVO_EXCECAO_MIN) — não
// importado de lá porque aquele módulo é só de servidor (Prisma/NextResponse).
const MOTIVO_MIN = 10;

// Diálogo "Forçar mesmo assim" da exceção de cadência semanal (D8). Só
// aparece quando a API respondeu 409 com `codigo: "CADENCIA"` e
// `podeForcar: true` (ADMIN) — para os demais papéis o caller só mostra a
// mensagem de erro, como sempre.
function ForcarCadenciaModal({
  mensagem,
  onConfirmar,
  onCancelar,
}: {
  mensagem: string;
  onConfirmar: (motivo: string) => void;
  onCancelar: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const motivoValido = motivo.trim().length >= MOTIVO_MIN;

  return (
    <div className="fixed inset-x-0 bottom-0 top-16 z-[60] flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
        <h2 className="mb-2 font-serif text-lg font-semibold text-fg">Fora da cadência semanal</h2>
        <p className="mb-3 whitespace-pre-line text-sm text-muted">{mensagem}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (motivoValido) onConfirmar(motivo.trim());
          }}
          className="space-y-3"
        >
          <label className="block text-sm font-medium text-fg">
            Motivo da exceção (vai para o log de auditoria)
          </label>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Ex.: reposição combinada com a paciente por causa do feriado"
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
          />
          {!motivoValido && (
            <p className="text-xs text-muted">Mínimo de {MOTIVO_MIN} caracteres.</p>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancelar}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!motivoValido}
              className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Forçar mesmo assim
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Hook que encapsula o fluxo: envia o JSON; se vier 409 de cadência e o
// usuário puder forçar, abre o diálogo e, com motivo, reenvia o MESMO body
// com `forcarCadencia: { motivo }`. Cancelar no diálogo devolve a resposta
// 409 original (o caller mostra a mensagem como já fazia). A resposta 409
// é clonada antes de ler, então o caller ainda pode chamar res.json().
// Quem usa precisa renderizar `modalForcarCadencia` no JSX.
export function useForcarCadencia() {
  const [pedido, setPedido] = useState<{ mensagem: string; resolver: (motivo: string | null) => void } | null>(null);

  const enviarComCadencia = useCallback(
    async (url: string, method: string, body: Record<string, unknown>): Promise<Response> => {
      const init = (b: Record<string, unknown>): RequestInit => ({
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      const res = await fetch(url, init(body));
      if (res.status !== 409) return res;
      const data = await res.clone().json().catch(() => null);
      if (data?.codigo !== "CADENCIA" || data?.podeForcar !== true) return res;

      const motivo = await new Promise<string | null>((resolver) =>
        setPedido({ mensagem: String(data.erro ?? "Esta operação fura a cadência semanal do paciente."), resolver })
      );
      if (!motivo) return res;
      return fetch(url, init({ ...body, forcarCadencia: { motivo } }));
    },
    []
  );

  const modalForcarCadencia = pedido ? (
    <ForcarCadenciaModal
      mensagem={pedido.mensagem}
      onConfirmar={(motivo) => {
        pedido.resolver(motivo);
        setPedido(null);
      }}
      onCancelar={() => {
        pedido.resolver(null);
        setPedido(null);
      }}
    />
  ) : null;

  return { enviarComCadencia, modalForcarCadencia };
}
