"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Papel } from "@/lib/permissoes";
import CampoTexto from "../_components/CampoTexto";

// Dados cadastrais/fiscais da clínica. Página autocontida: não depende do
// estado do configuracoes/legado/page.tsx — carrega e salva por conta própria
// via GET/PATCH /api/clinica (o PATCH já aceita esses campos desde o Bloco 1
// e normaliza cnpj/cep pra só dígitos no servidor).
interface DadosGerais {
  nome: string;
  razaoSocial: string;
  cnpj: string;
  emailContato: string;
  telefoneContato: string;
  enderecoLogradouro: string;
  enderecoNumero: string;
  enderecoComplemento: string;
  enderecoBairro: string;
  enderecoCidade: string;
  enderecoUF: string;
  cep: string;
}

const FORM_VAZIO: DadosGerais = {
  nome: "",
  razaoSocial: "",
  cnpj: "",
  emailContato: "",
  telefoneContato: "",
  enderecoLogradouro: "",
  enderecoNumero: "",
  enderecoComplemento: "",
  enderecoBairro: "",
  enderecoCidade: "",
  enderecoUF: "",
  cep: "",
};

// Aceita qualquer objeto vindo da API (GET ou PATCH devolvem o mesmo formato)
// e preenche só os campos que esta seção edita, com "" no lugar de null.
function mapParaForm(dados: Record<string, unknown>): DadosGerais {
  return {
    nome: (dados.nome as string) ?? "",
    razaoSocial: (dados.razaoSocial as string) ?? "",
    cnpj: (dados.cnpj as string) ?? "",
    emailContato: (dados.emailContato as string) ?? "",
    telefoneContato: (dados.telefoneContato as string) ?? "",
    enderecoLogradouro: (dados.enderecoLogradouro as string) ?? "",
    enderecoNumero: (dados.enderecoNumero as string) ?? "",
    enderecoComplemento: (dados.enderecoComplemento as string) ?? "",
    enderecoBairro: (dados.enderecoBairro as string) ?? "",
    enderecoCidade: (dados.enderecoCidade as string) ?? "",
    enderecoUF: (dados.enderecoUF as string) ?? "",
    cep: (dados.cep as string) ?? "",
  };
}

export default function DadosGeraisPage() {
  const router = useRouter();
  const [carregando, setCarregando] = useState(true);
  const [erroCarregar, setErroCarregar] = useState(false);
  const [form, setForm] = useState<DadosGerais>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState("");
  const [salvo, setSalvo] = useState(false);

  // Espelho de UX: OPERADOR não tem editarConfiguracoes, então nem chega a
  // ver este formulário — a checagem que vale é o 403 do PATCH /api/clinica.
  useEffect(() => {
    fetch("/api/auth/usuario")
      .then((r) => (r.ok ? r.json() : null))
      .then((dados: { papel: Papel } | null) => {
        if (dados?.papel === "OPERADOR") router.replace("/painel");
      });
  }, [router]);

  useEffect(() => {
    async function carregar() {
      setCarregando(true);
      setErroCarregar(false);
      try {
        const res = await fetch("/api/clinica");
        if (!res.ok) {
          setErroCarregar(true);
          return;
        }
        setForm(mapParaForm(await res.json()));
      } catch {
        setErroCarregar(true);
      } finally {
        setCarregando(false);
      }
    }
    carregar();
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    setSalvo(false);
  }

  async function handleSalvar(e: React.FormEvent) {
    e.preventDefault();
    setErroSalvar("");
    setSalvo(false);
    setSalvando(true);
    try {
      const res = await fetch("/api/clinica", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const dados = await res.json().catch(() => null);
      if (!res.ok) {
        setErroSalvar(dados?.erro ?? "não foi possível salvar");
        return;
      }
      setForm(mapParaForm(dados));
      setSalvo(true);
    } catch {
      setErroSalvar("não foi possível salvar");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div>
      <h2 className="mb-4 font-serif text-lg font-semibold text-fg">Dados gerais</h2>

      {carregando ? (
        <p className="text-sm text-muted">Carregando...</p>
      ) : erroCarregar ? (
        <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
          Não foi possível carregar os dados da clínica.
        </p>
      ) : (
        <form onSubmit={handleSalvar} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <CampoTexto
            label="Nome da clínica"
            name="nome"
            value={form.nome}
            onChange={handleChange}
            required
            className="sm:col-span-2"
          />
          <CampoTexto label="Razão social" name="razaoSocial" value={form.razaoSocial} onChange={handleChange} />
          <CampoTexto label="CNPJ" name="cnpj" value={form.cnpj} onChange={handleChange} />
          <CampoTexto label="E-mail de contato" name="emailContato" value={form.emailContato} onChange={handleChange} />
          <CampoTexto label="Telefone de contato" name="telefoneContato" value={form.telefoneContato} onChange={handleChange} />

          <h3 className="mt-2 text-xs font-semibold uppercase tracking-wide text-gold sm:col-span-2">
            Endereço
          </h3>
          <CampoTexto label="CEP" name="cep" value={form.cep} onChange={handleChange} />
          <CampoTexto label="Logradouro" name="enderecoLogradouro" value={form.enderecoLogradouro} onChange={handleChange} />
          <CampoTexto label="Número" name="enderecoNumero" value={form.enderecoNumero} onChange={handleChange} />
          <CampoTexto label="Complemento" name="enderecoComplemento" value={form.enderecoComplemento} onChange={handleChange} />
          <CampoTexto label="Bairro" name="enderecoBairro" value={form.enderecoBairro} onChange={handleChange} />
          <CampoTexto label="Cidade" name="enderecoCidade" value={form.enderecoCidade} onChange={handleChange} />
          <CampoTexto label="UF" name="enderecoUF" value={form.enderecoUF} onChange={handleChange} />

          {erroSalvar && (
            <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red sm:col-span-2">{erroSalvar}</p>
          )}

          <div className="flex items-center gap-3 sm:col-span-2">
            <button
              type="submit"
              disabled={salvando}
              className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {salvando ? "Salvando..." : "Salvar"}
            </button>
            {salvo && <span className="text-sm text-green">Salvo!</span>}
          </div>
        </form>
      )}
    </div>
  );
}
