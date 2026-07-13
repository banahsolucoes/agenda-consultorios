// Campo de cor reutilizável das telas de Configurações — seletor nativo de
// cor + input de texto com o hex, os dois amarrados ao mesmo value/onChange.
export default function CampoCor({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-fg">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          name={name}
          value={value}
          onChange={onChange}
          className="h-9 w-12 cursor-pointer rounded border border-border bg-bg"
        />
        <input
          type="text"
          name={name}
          value={value}
          onChange={onChange}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
        />
      </div>
    </div>
  );
}
