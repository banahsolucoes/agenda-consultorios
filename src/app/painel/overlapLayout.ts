// Distribui sessões que se sobrepõem no tempo em colunas lado a lado — o
// mesmo problema de "layout de colisão" resolvido por calendários como o
// Google Agenda: cada grupo de sessões conectadas por sobreposição de
// horário recebe o mesmo número total de colunas, e cada sessão a primeira
// coluna livre (sem sobrepor a última sessão já alocada nela).

export interface EventoComHorario {
  id: string;
  inicioMs: number;
  fimMs: number;
}

export interface LayoutColuna {
  coluna: number;
  totalColunas: number;
}

export function calcularLayoutColunas(eventos: EventoComHorario[]): Map<string, LayoutColuna> {
  const resultado = new Map<string, LayoutColuna>();
  if (eventos.length === 0) return resultado;

  const ordenados = [...eventos].sort((a, b) => a.inicioMs - b.inicioMs || b.fimMs - a.fimMs);

  let colunas: EventoComHorario[][] = [];
  let grupoIds: string[] = [];
  let fimGrupo = -Infinity;

  function fecharGrupo() {
    if (grupoIds.length === 0) return;
    const totalColunas = colunas.length;
    for (const id of grupoIds) {
      const atual = resultado.get(id);
      if (atual) resultado.set(id, { ...atual, totalColunas });
    }
    colunas = [];
    grupoIds = [];
  }

  for (const ev of ordenados) {
    if (ev.inicioMs >= fimGrupo) {
      fecharGrupo();
      fimGrupo = -Infinity;
    }
    let colunaLivre = colunas.findIndex((col) => col[col.length - 1].fimMs <= ev.inicioMs);
    if (colunaLivre === -1) {
      colunaLivre = colunas.length;
      colunas.push([]);
    }
    colunas[colunaLivre].push(ev);
    resultado.set(ev.id, { coluna: colunaLivre, totalColunas: 0 });
    grupoIds.push(ev.id);
    fimGrupo = Math.max(fimGrupo, ev.fimMs);
  }
  fecharGrupo();

  return resultado;
}
