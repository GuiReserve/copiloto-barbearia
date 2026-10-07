import { brl, num, pct } from './format';
import type { Snapshot } from './metrics';

export const GOALS: Record<string, { label: string; fmt: (n: number) => string; value: (s: Snapshot) => number }> = {
  faturamento: { label: 'Faturamento mensal', fmt: brl, value: (s) => s.fin.revenue },
  clientes: { label: 'Clientes atendidos', fmt: num, value: (s) => s.clients.atendidos },
  novos_clientes: { label: 'Novos clientes', fmt: num, value: (s) => s.clients.novos },
  ticket_medio: { label: 'Ticket médio', fmt: brl, value: (s) => s.fin.ticket },
  ocupacao: { label: 'Ocupação da agenda (%)', fmt: pct, value: (s) => s.occ.pct },
  seguidores: { label: 'Seguidores no Instagram', fmt: num, value: (s) => s.seguidores },
  agendamentos: { label: 'Agendamentos', fmt: num, value: (s) => s.agenda.total - s.agenda.cancelados },
  receita_hora: { label: 'Receita por hora', fmt: brl, value: (s) => s.porHora },
};

