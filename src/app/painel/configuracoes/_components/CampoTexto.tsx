// Campo de texto reutilizável das telas de Configurações (legado e as novas
// sub-rotas por seção) — label + input controlado, mesmo estilo em todo lugar.
export default function CampoTexto({
  label,
  name,
  value,
  onChange,
  pattern,
  required = false,
  className = "",
}: {
  label: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  pattern?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-sm font-medium text-fg">{label}</label>
      <input
        type="text"
        name={name}
        value={value}
        onChange={onChange}
        pattern={pattern}
        required={required}
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
      />
    </div>
  );
}
