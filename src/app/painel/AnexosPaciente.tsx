"use client";

import { useEffect, useState } from "react";
import { TIPOS_PERMITIDOS, TAMANHO_MAX_BYTES, BUCKET_ANEXOS } from "@/lib/anexos";
import { createClient } from "@/lib/supabase/client";

interface Anexo {
  id: string;
  nomeArquivo: string;
  mimeType: string;
  tamanho: number;
  criadoEm: string;
}

function formatarTamanho(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Seção "Anexos" do modal de cadastro/edição de paciente — só existe em modo
// edição, já que o upload depende de um pacienteId já salvo no banco.
export default function AnexosPaciente({ pacienteId }: { pacienteId: string }) {
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [baixandoId, setBaixandoId] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    carregarAnexos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pacienteId]);

  async function carregarAnexos() {
    setCarregando(true);
    try {
      const res = await fetch(`/api/pacientes/${pacienteId}/anexos`);
      if (!res.ok) throw new Error();
      setAnexos(await res.json());
    } catch {
      setErro("não foi possível carregar os anexos");
    } finally {
      setCarregando(false);
    }
  }

  async function handleSelecionarArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;

    setErro("");

    if (!TIPOS_PERMITIDOS.includes(arquivo.type as (typeof TIPOS_PERMITIDOS)[number])) {
      setErro("tipo de arquivo inválido — envie imagem (JPG/PNG) ou PDF");
      return;
    }
    if (arquivo.size > TAMANHO_MAX_BYTES) {
      setErro("arquivo muito grande — o limite é 4,5MB");
      return;
    }

    setEnviando(true);
    try {
      const resUrl = await fetch(`/api/pacientes/${pacienteId}/anexos/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomeArquivo: arquivo.name, mimeType: arquivo.type, tamanho: arquivo.size }),
      });
      const dadosUrl = await resUrl.json();
      if (!resUrl.ok) throw new Error(dadosUrl.erro || "não foi possível gerar a URL de upload");

      const supabase = createClient();
      const { error: erroUpload } = await supabase.storage
        .from(BUCKET_ANEXOS)
        .uploadToSignedUrl(dadosUrl.path, dadosUrl.token, arquivo);
      if (erroUpload) throw new Error("falha ao enviar o arquivo");

      const resConfirmar = await fetch(`/api/pacientes/${pacienteId}/anexos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nomeArquivo: arquivo.name,
          mimeType: arquivo.type,
          tamanho: arquivo.size,
          path: dadosUrl.path,
        }),
      });
      const anexoConfirmado = await resConfirmar.json();
      if (!resConfirmar.ok) throw new Error(anexoConfirmado.erro || "não foi possível confirmar o anexo");

      setAnexos((atual) => [anexoConfirmado, ...atual]);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "não foi possível enviar o anexo");
    } finally {
      setEnviando(false);
    }
  }

  async function handleAbrirAnexo(anexo: Anexo) {
    setBaixandoId(anexo.id);
    try {
      const res = await fetch(`/api/pacientes/${pacienteId}/anexos/${anexo.id}`);
      const dados = await res.json();
      if (!res.ok) throw new Error(dados.erro || "não foi possível abrir o anexo");
      window.open(dados.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "não foi possível abrir o anexo");
    } finally {
      setBaixandoId(null);
    }
  }

  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gold">
        Anexos
      </h3>
      <p className="mb-2 text-xs text-muted">Anexos de até 4,5 MB (imagem ou PDF)</p>

      <label className="inline-block cursor-pointer rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg">
        {enviando ? "Enviando..." : "Selecionar arquivo"}
        <input
          type="file"
          accept=".jpg,.jpeg,.png,.pdf"
          onChange={handleSelecionarArquivo}
          disabled={enviando}
          className="hidden"
        />
      </label>

      {erro && <p className="mt-2 text-sm text-red">{erro}</p>}

      <div className="mt-3 space-y-2">
        {carregando ? (
          <p className="text-sm text-muted">Carregando anexos...</p>
        ) : anexos.length === 0 ? (
          <p className="text-sm text-muted">Nenhum anexo ainda.</p>
        ) : (
          anexos.map((anexo) => (
            <div
              key={anexo.id}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-fg">{anexo.nomeArquivo}</p>
                <p className="text-xs text-muted">{formatarTamanho(anexo.tamanho)}</p>
              </div>
              <button
                type="button"
                onClick={() => handleAbrirAnexo(anexo)}
                disabled={baixandoId === anexo.id}
                className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                {baixandoId === anexo.id ? "Abrindo..." : "Abrir"}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
