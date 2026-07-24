"use client";

import { useState } from "react";
import DatePickerSP from "@/app/painel/DatePickerSP";

export interface TarefaFormValores {
  titulo: string;
  descricao: string;
  dataVencimento: string;
  dataAviso: string;
  recorrencia: "NENHUMA" | "MENSAL";
}

export const TAREFA_FORM_VAZIO: TarefaFormValores = {
  titulo: "",
  descricao: "",
  dataVencimento: "",
  dataAviso: "",
  recorrencia: "NENHUMA",
};

interface TarefaFormProps {
  tituloModal: string;
  valoresIniciais?: TarefaFormValores;
  erroExterno?: string;
  salvando: boolean;
  textoSalvar: string;
  textoSalvando: string;
  onSalvar: (valores: TarefaFormValores) => void;
  onCancelar: () => void;
}

// Modal de criar/editar tarefa (tipo CONTA) — antes duplicado quase
// idêntico em painel/page.tsx (só criação) e tarefas/page.tsx (criação e
// edição). Unificado aqui; a diferença real entre os dois usos (editar
// existe ou não, textos de título/botão, o que fazer no POST/PATCH e
// depois de salvar) fica a cargo de quem chama, via props.
//
// Estado do formulário é interno e inicializado só uma vez a partir de
// `valoresIniciais` (componente não-controlado) — quem chama força reset
// trocando a `key` do componente (ex.: `key={tarefaEditando?.id ?? "novo"}`)
// ao abrir pra outra tarefa/nova tarefa, nunca via re-render normal. Um
// useEffect ouvindo `valoresIniciais` foi cogitado e descartado: como esse
// objeto é recriado a cada render do pai, resetaria o formulário (inclusive
// apagando o que o usuário já digitou) em qualquer re-render, não só na
// troca real de tarefa — por exemplo, ao marcar `salvando=true` durante o
// próprio envio.
export default function TarefaForm({
  tituloModal,
  valoresIniciais,
  erroExterno,
  salvando,
  textoSalvar,
  textoSalvando,
  onSalvar,
  onCancelar,
}: TarefaFormProps) {
  const [form, setForm] = useState<TarefaFormValores>(valoresIniciais ?? TAREFA_FORM_VAZIO);
  const [erroLocal, setErroLocal] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.titulo.trim()) {
      setErroLocal("informe o título");
      return;
    }
    setErroLocal("");
    onSalvar(form);
  }

  const erro = erroLocal || erroExterno;

  return (
    <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
        <h2 className="mb-4 font-serif text-lg font-semibold text-fg">{tituloModal}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-fg">Título</label>
            <input
              type="text"
              required
              value={form.titulo}
              onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-fg">Descrição (opcional)</label>
            <textarea
              value={form.descricao}
              onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
              rows={2}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block whitespace-nowrap text-sm font-medium text-fg">Data de vencimento</label>
              <DatePickerSP
                value={form.dataVencimento}
                onChange={(v) => setForm((f) => ({ ...f, dataVencimento: v }))}
              />
            </div>
            <div>
              <label className="mb-1 block whitespace-nowrap text-sm font-medium text-fg">Data de aviso</label>
              <DatePickerSP value={form.dataAviso} onChange={(v) => setForm((f) => ({ ...f, dataAviso: v }))} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-fg">Recorrência</label>
            <select
              value={form.recorrencia}
              onChange={(e) => setForm((f) => ({ ...f, recorrencia: e.target.value as "NENHUMA" | "MENSAL" }))}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            >
              <option value="NENHUMA">Nenhuma</option>
              <option value="MENSAL">Mensal</option>
            </select>
          </div>

          {erro && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erro}</p>}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancelar}
              disabled={salvando}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando || !form.titulo.trim()}
              className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {salvando ? textoSalvando : textoSalvar}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
