"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// Opções dos selects do formulário, na mesma ordem dos enums do Prisma
const DIAS_SEMANA = [
  "SEGUNDA",
  "TERCA",
  "QUARTA",
  "QUINTA",
  "SEXTA",
  "SABADO",
  "DOMINGO",
] as const;

const TIPOS_SESSAO = [
  "ONLINE",
  "PRESENCIAL",
  "AVAL_ONLINE",
  "AVAL_PRESENCIAL",
] as const;

interface Paciente {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  statusGeral: "ATIVO" | "CANCELADO" | "FINALIZADO";
}

// Estado inicial do formulário de novo paciente
const FORM_VAZIO = {
  nome: "",
  cpf: "",
  telefone: "",
  email: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  estado: "",
  quemIndicou: "",
  diaPreferido: DIAS_SEMANA[0] as string,
  horarioFixo: "",
  tipoSessao: TIPOS_SESSAO[0] as string,
};

// Remove acentos e normaliza para minúsculas, usado no filtro de busca
function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export default function PainelPage() {
  const router = useRouter();

  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [busca, setBusca] = useState("");
  const [saindo, setSaindo] = useState(false);

  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState("");

  // Busca a lista de pacientes da clínica logada
  async function carregarPacientes() {
    setCarregandoLista(true);
    try {
      const res = await fetch("/api/pacientes");
      if (res.ok) {
        setPacientes(await res.json());
      }
    } finally {
      setCarregandoLista(false);
    }
  }

  useEffect(() => {
    carregarPacientes();
  }, []);

  // Lista filtrada por nome, ignorando maiúsculas/minúsculas e acentos
  const pacientesFiltrados = useMemo(() => {
    const termo = normalizar(busca.trim());
    if (!termo) return pacientes;
    return pacientes.filter((p) => normalizar(p.nome).includes(termo));
  }, [pacientes, busca]);

  function abrirModal() {
    setForm(FORM_VAZIO);
    setErroForm("");
    setModalAberto(true);
  }

  function fecharModal() {
    if (salvando) return;
    setModalAberto(false);
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  async function handleSalvar(e: React.FormEvent) {
    e.preventDefault();
    setErroForm("");
    setSalvando(true);

    try {
      const res = await fetch("/api/pacientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErroForm(data?.erro ?? "não foi possível salvar o paciente");
        return;
      }

      setModalAberto(false);
      await carregarPacientes();
    } catch {
      setErroForm("não foi possível salvar o paciente");
    } finally {
      setSalvando(false);
    }
  }

  async function handleSair() {
    setSaindo(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Cabeçalho */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <h1 className="text-lg font-semibold text-slate-800">
            Agenda Consultórios
          </h1>
          <button
            onClick={handleSair}
            disabled={saindo}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saindo ? "Saindo..." : "Sair"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* Barra de busca + ação de novo paciente */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar paciente por nome..."
            className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
          />
          <button
            onClick={abrirModal}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700"
          >
            + Novo paciente
          </button>
        </div>

        {/* Lista de pacientes */}
        {carregandoLista ? (
          <p className="text-sm text-slate-500">Carregando pacientes...</p>
        ) : pacientesFiltrados.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nenhum paciente encontrado.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pacientesFiltrados.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <p className="font-medium text-slate-800">{p.nome}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {p.telefone ?? "sem telefone"}
                </p>
                <span
                  className={`mt-3 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    p.statusGeral === "ATIVO"
                      ? "bg-teal-50 text-teal-700"
                      : p.statusGeral === "FINALIZADO"
                        ? "bg-slate-100 text-slate-600"
                        : "bg-red-50 text-red-600"
                  }`}
                >
                  {p.statusGeral}
                </span>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Modal de cadastro de paciente */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">
                Novo paciente
              </h2>
              <button
                onClick={fecharModal}
                className="text-slate-400 hover:text-slate-600"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSalvar} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Campo label="Nome" name="nome" value={form.nome} onChange={handleChange} required className="sm:col-span-2" />
              <Campo label="CPF" name="cpf" value={form.cpf} onChange={handleChange} />
              <Campo label="Telefone" name="telefone" value={form.telefone} onChange={handleChange} />
              <Campo label="E-mail" name="email" value={form.email} onChange={handleChange} type="email" className="sm:col-span-2" />

              <Campo label="CEP" name="cep" value={form.cep} onChange={handleChange} />
              <Campo label="Logradouro" name="logradouro" value={form.logradouro} onChange={handleChange} />
              <Campo label="Número" name="numero" value={form.numero} onChange={handleChange} />
              <Campo label="Complemento" name="complemento" value={form.complemento} onChange={handleChange} />
              <Campo label="Bairro" name="bairro" value={form.bairro} onChange={handleChange} />
              <Campo label="Cidade" name="cidade" value={form.cidade} onChange={handleChange} />
              <Campo label="Estado" name="estado" value={form.estado} onChange={handleChange} />
              <Campo label="Quem indicou" name="quemIndicou" value={form.quemIndicou} onChange={handleChange} />

              {/* Dia preferido */}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Dia preferido
                </label>
                <select
                  name="diaPreferido"
                  value={form.diaPreferido}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                >
                  {DIAS_SEMANA.map((dia) => (
                    <option key={dia} value={dia}>
                      {dia}
                    </option>
                  ))}
                </select>
              </div>

              <Campo
                label="Horário fixo (HH:MM)"
                name="horarioFixo"
                value={form.horarioFixo}
                onChange={handleChange}
                required
                placeholder="14:00"
                pattern="^([01]\d|2[0-3]):[0-5]\d$"
              />

              {/* Tipo de sessão */}
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Tipo de sessão
                </label>
                <select
                  name="tipoSessao"
                  value={form.tipoSessao}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                >
                  {TIPOS_SESSAO.map((tipo) => (
                    <option key={tipo} value={tipo}>
                      {tipo}
                    </option>
                  ))}
                </select>
              </div>

              {erroForm && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 sm:col-span-2">
                  {erroForm}
                </p>
              )}

              <div className="flex justify-end gap-3 sm:col-span-2">
                <button
                  type="button"
                  onClick={fecharModal}
                  disabled={salvando}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvando ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Campo de texto reutilizável do formulário de paciente
function Campo({
  label,
  name,
  value,
  onChange,
  type = "text",
  required = false,
  placeholder,
  pattern,
  className = "",
}: {
  label: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  pattern?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        pattern={pattern}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
      />
    </div>
  );
}
