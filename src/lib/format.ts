export const brl = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const brl0 = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
export const num = (n: number | null | undefined) => (n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
export const pct = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
export const ratio = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
export const hours = (min: number) => `${(min / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;

// datas como texto 'AAAA-MM-DD', sem depender do fuso do servidor
const utc = (d: string) => new Date(`${d}T00:00:00Z`);
export const addDays = (d: string, n: number) => new Date(utc(d).getTime() + n * 864e5).toISOString().slice(0, 10);
export const weekday = (d: string) => utc(d).getUTCDay();
export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
export const monthEnd = (d: string) => { const x = utc(monthStart(d)); x.setUTCMonth(x.getUTCMonth() + 1); return addDays(x.toISOString().slice(0, 10), -1); };
export const addMonths = (d: string, n: number) => { const x = utc(monthStart(d)); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
export const daysBetween = (a: string, b: string) => Math.round((utc(b).getTime() - utc(a).getTime()) / 864e5);
export const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const dmyFull = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const longDate = (d: string) => `${DIAS[weekday(d)]}, ${Number(d.slice(8, 10))} de ${MESES[Number(d.slice(5, 7)) - 1]}`;
export const monthName = (d: string) => `${MESES[Number(d.slice(5, 7)) - 1]} de ${d.slice(0, 4)}`;
export const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(utc(s).getTime());
export const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export const STATUS: Record<string, string> = {
  agendado: 'Agendado', confirmado: 'Confirmado', em_atendimento: 'Em atendimento', concluido: 'Concluído',
  cancelado: 'Cancelado', faltou: 'Faltou', encaixado: 'Encaixado',
};
export const CATEGORIAS: Record<string, string> = {
  aluguel: 'Aluguel', agua: 'Água', energia: 'Energia', internet: 'Internet', salarios: 'Salários', comissao: 'Comissão',
  produtos: 'Produtos', marketing: 'Marketing', sistemas: 'Sistemas', outros: 'Outros', atendimento: 'Atendimento',
};
export const ROLES: Record<string, string> = { admin: 'Admin', barbeiro: 'Barbeiro', recepcao: 'Recepção' };

export const TIMEZONES = ['America/Sao_Paulo', 'America/Bahia', 'America/Fortaleza', 'America/Recife', 'America/Belem', 'America/Manaus',
  'America/Cuiaba', 'America/Campo_Grande', 'America/Porto_Velho', 'America/Boa_Vista', 'America/Rio_Branco', 'America/Noronha'] as const;

