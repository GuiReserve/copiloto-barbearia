import 'server-only';
import type { Row, Tx } from './db';
import { addDays, addMonths, daysBetween, dmyFull, isDate, monthEnd, monthStart } from './format';

export type Period = { key: string; from: string; to: string; label: string };
export const PERIODS = [['hoje', 'Hoje'], ['7d', '7 dias'], ['30d', '30 dias'], ['mes', 'Mês atual'], ['mes_ant', 'Mês anterior']] as const;

export async function today(tx: Tx) { return (await tx.one<{ d: string }>(`select current_date::text d`))!.d; }

export function parsePeriod(sp: Record<string, string | string[] | undefined>, t: string, fallback = 'mes'): Period {
  const key = typeof sp.p === 'string' ? sp.p : fallback;
  if (key === 'custom' && isDate(sp.de) && isDate(sp.ate) && sp.de <= sp.ate && daysBetween(sp.de, sp.ate) <= 366)
    return { key, from: sp.de, to: sp.ate, label: `${dmyFull(sp.de)} a ${dmyFull(sp.ate)}` };
  switch (key) {
    case 'hoje': return { key, from: t, to: t, label: 'Hoje' };
    case '7d': return { key, from: addDays(t, -6), to: t, label: 'Últimos 7 dias' };
    case '30d': return { key, from: addDays(t, -29), to: t, label: 'Últimos 30 dias' };
    case 'mes_ant': { const m = addMonths(t, -1); return { key, from: m, to: monthEnd(m), label: 'Mês anterior' }; }
    default: return { key: 'mes', from: monthStart(t), to: monthEnd(t), label: 'Mês atual' };
  }
}
/** período imediatamente anterior, com a mesma duração */
export const previous = (p: Period): [string, string] => {
  const n = daysBetween(p.from, p.to) + 1;
  return [addDays(p.from, -n), addDays(p.from, -1)];
};

const RANGE = `starts_at >= $1::date and starts_at < ($2::date + 1)`;

export async function agendaStats(tx: Tx, from: string, to: string, barberId?: string | null) {
  return (await tx.one(
    `select count(*)::int total,
            count(*) filter (where status = 'concluido')::int concluidos,
            count(*) filter (where status = 'cancelado')::int cancelados,
            count(*) filter (where status = 'faltou')::int faltas,
            count(*) filter (where status not in ('cancelado', 'faltou', 'concluido'))::int pendentes,
            coalesce(sum(price) filter (where status = 'concluido'), 0)::float8 realizado,
            coalesce(sum(price) filter (where status not in ('cancelado', 'faltou', 'concluido')), 0)::float8 previsto,
            count(distinct client_id) filter (where status = 'concluido')::int clientes
     from appointments where ${RANGE} and ($3::uuid is null or barber_id = $3)`, [from, to, barberId ?? null]))!;
}

/** Custos fixos rateados pelos dias do período (um aluguel de R$ 3.000 pesa R$ 100 por dia em um mês de 30 dias). */
export async function fixedCosts(tx: Tx, from: string, to: string) {
  const rows = await tx.q(`select name, category, amount::float8 amount, starts_on::text, ends_on::text from fixed_costs`);
  let totalFixed = 0;
  for (let m = monthStart(from); m <= to; m = addMonths(m, 1)) {
    const end = monthEnd(m), dim = daysBetween(m, end) + 1;
    for (const r of rows) {
      const a = [from, m, monthStart(r.starts_on)].sort().at(-1)!;
      const b = [to, end, r.ends_on ?? '9999-12-31'].sort()[0];
      if (b >= a) totalFixed += (r.amount * (daysBetween(a, b) + 1)) / dim;
    }
  }
  return totalFixed;
}

export async function finance(tx: Tx, from: string, to: string, fixedUntil = to) {
  const rev = (await tx.one(
    `select coalesce(sum(amount), 0)::float8 total,
            coalesce(sum(amount) filter (where category = 'atendimento'), 0)::float8 atendimento,
            coalesce(sum(amount) filter (where category = 'produtos'), 0)::float8 produtos,
            coalesce(sum(amount) filter (where category = 'outros'), 0)::float8 outros,
            count(*) filter (where category = 'atendimento')::int atendimentos
     from revenues where received_on between $1 and $2`, [from, to]))!;
  const exp = (await tx.one(`select coalesce(sum(amount), 0)::float8 total from expenses where spent_on between $1 and $2`, [from, to]))!;
  const com = (await tx.one(
    `select coalesce(sum(a.price * coalesce(s.commission_pct, b.commission_pct) / 100), 0)::float8 total
     from appointments a join services s on s.id = a.service_id join barbers b on b.id = a.barber_id
     where a.status = 'concluido' and a.${RANGE}`, [from, to]))!;
  const fixed = fixedUntil >= from ? await fixedCosts(tx, from, fixedUntil < to ? fixedUntil : to) : 0; // mês em andamento: só os dias já corridos
  const variable = exp.total + com.total;
  const costs = fixed + variable;
  const profit = rev.total - costs;
  return {
    revenue: rev.total as number, byCategory: rev, expenses: exp.total as number, commissions: com.total as number,
    fixed, variable, costs, profit, margin: rev.total > 0 ? (profit / rev.total) * 100 : 0,
    ticket: rev.atendimentos > 0 ? rev.atendimento / rev.atendimentos : 0,
  };
}

export async function revenueByBarber(tx: Tx, from: string, to: string) {
  return tx.q(
    `select b.id, b.name, count(a.id)::int atendimentos, coalesce(sum(a.price), 0)::float8 total
     from barbers b left join appointments a on a.barber_id = b.id and a.status = 'concluido' and a.${RANGE}
     where b.active group by b.id order by total desc, b.name`, [from, to]);
}
export async function revenueByService(tx: Tx, from: string, to: string) {
  return tx.q(
    `select s.name, count(*)::int atendimentos, sum(a.price)::float8 total,
            (sum(a.price) / nullif(sum(extract(epoch from a.ends_at - a.starts_at)) / 3600, 0))::float8 por_hora
     from appointments a join services s on s.id = a.service_id
     where a.status = 'concluido' and a.${RANGE} group by s.name order by total desc`, [from, to]);
}
export async function revenueByDay(tx: Tx, from: string, to: string) {
  return tx.q<{ d: string; total: number; novos: number }>(
    `select g::date::text d,
            coalesce((select sum(amount) from revenues r where r.received_on = g::date), 0)::float8 total,
            (select count(*) from clients c where c.created_at >= g and c.created_at < g + interval '1 day')::int novos
     from generate_series($1::date, $2::date, interval '1 day') g order by 1`, [from, to]);
}

/** Classificação de cada cliente, calculada a partir do histórico real de atendimentos. */
export const CLIENT_STATS = `
  select c.*, coalesce(h.visits, 0)::int visits, coalesce(h.spent, 0)::float8 spent,
         h.first_visit::date::text first_visit, h.last_visit::date::text last_visit,
         case when coalesce(h.visits, 0) = 0 then 'novo'
              when current_date - h.last_visit::date > st.lost_days then 'perdido'
              when current_date - h.last_visit::date > st.inactive_days then 'inativo'
              when h.visits >= st.vip_visits then 'vip'
              when h.visits >= 2 then 'recorrente' else 'novo' end as classe
  from clients c
  cross join (select * from settings where barbershop_id = app_shop()) st
  left join lateral (select count(*) visits, sum(price) spent, min(starts_at) first_visit, max(starts_at) last_visit
                     from appointments a where a.client_id = c.id and a.status = 'concluido') h on true`;
export const CLASSES: Record<string, string> = { novo: 'Novo', recorrente: 'Recorrente', vip: 'VIP', inativo: 'Inativo', perdido: 'Perdido' };

export async function clientStats(tx: Tx, from: string, to: string) {
  const novos = (await tx.one(`select count(*)::int n from clients where created_at >= $1::date and created_at < ($2::date + 1)`, [from, to]))!.n as number;
  const served = (await tx.one(
    `select count(*)::int atendidos, count(*) filter (where antes)::int recorrentes from (
       select a.client_id, exists (select from appointments p where p.client_id = a.client_id and p.status = 'concluido'
                                    and p.starts_at < min(a.starts_at)) antes
       from appointments a where a.status = 'concluido' and a.${RANGE} group by a.client_id) x`, [from, to]))!;
  const cls = await tx.q<{ classe: string; n: number }>(`select classe, count(*)::int n from (${CLIENT_STATS}) x group by classe`);
  const by = Object.fromEntries(cls.map((r) => [r.classe, r.n]));
  const fila = (await tx.one(`select count(*)::int n from waiting_list where status = 'ativo' and desired_date >= current_date`))?.n ?? 0;
  return {
    novos, atendidos: served.atendidos as number, recorrentes: served.recorrentes as number,
    retorno: served.atendidos > 0 ? (served.recorrentes / served.atendidos) * 100 : 0,
    inativos: by.inativo ?? 0, perdidos: by.perdido ?? 0, fila: fila as number,
  };
}

/** Funil por origem: audiência registrada + o que de fato virou agenda, atendimento e dinheiro. */
export async function funnel(tx: Tx, from: string, to: string) {
  return tx.q(
    `select s.id, s.name, s.kind,
       coalesce(m.views, 0)::int views, coalesce(m.interactions, 0)::int interactions, coalesce(m.clicks, 0)::int clicks,
       coalesce(m.leads, 0)::int leads, coalesce(m.calls, 0)::int calls, coalesce(m.route_requests, 0)::int route_requests,
       coalesce(m.site_visits, 0)::int site_visits, m.followers_first, m.followers_last,
       coalesce(a.agendamentos, 0)::int agendamentos, coalesce(a.atendimentos, 0)::int atendimentos,
       coalesce(a.receita, 0)::float8 receita, coalesce(a.recorrentes, 0)::int recorrentes,
       (select count(*) from clients c where c.source_id = s.id and c.created_at >= $1::date and c.created_at < ($2::date + 1))::int novos
     from marketing_sources s
     left join lateral (
       select sum(views) views, sum(interactions) interactions, sum(clicks) clicks, sum(leads) leads, sum(calls) calls,
              sum(route_requests) route_requests, sum(site_visits) site_visits,
              (array_agg(followers order by metric_date) filter (where followers is not null))[1] followers_first,
              (array_agg(followers order by metric_date desc) filter (where followers is not null))[1] followers_last
       from marketing_metrics where source_id = s.id and metric_date between $1 and $2) m on true
     left join lateral (
       select count(*) filter (where status <> 'cancelado') agendamentos,
              count(*) filter (where status = 'concluido') atendimentos,
              sum(price) filter (where status = 'concluido') receita,
              count(distinct client_id) filter (where status = 'concluido' and exists (
                select from appointments p where p.client_id = ap.client_id and p.status = 'concluido' and p.id <> ap.id)) recorrentes
       from appointments ap where ap.source_id = s.id and ap.${RANGE}) a on true
     where s.active order by receita desc, novos desc, s.name`, [from, to]);
}

/** Indicadores individuais de um barbeiro, tirados dos próprios atendimentos. */
export async function barberStats(tx: Tx, barberId: string, from: string, to: string, t: string): Promise<Row> {
  const { occupancy } = await import('./slots');
  const a = await agendaStats(tx, from, to, barberId);
  const occ = await occupancy(tx, from, to < t ? to : t, barberId);
  const c = (await tx.one(
    `select count(*) filter (where not antes)::int novos, count(*) filter (where antes)::int recorrentes from (
       select a.client_id, exists (select from appointments p where p.client_id = a.client_id and p.status = 'concluido'
                                    and p.starts_at < min(a.starts_at)) antes
       from appointments a where a.status = 'concluido' and a.barber_id = $3 and a.${RANGE} group by a.client_id) x`, [from, to, barberId]))!;
  return {
    ...a, occ, novos: c.novos as number, recorrentes: c.recorrentes as number,
    ticket: a.concluidos > 0 ? a.realizado / a.concluidos : 0,
    porHora: occ.avail > 0 ? a.realizado / (occ.avail / 60) : 0,
  };
}

/** Tudo o que o painel, as metas e os relatórios precisam para um período (só admin: usa o financeiro). */
export async function snapshot(tx: Tx, p: Period, t: string) {
  const { occupancy } = await import('./slots');
  const agenda = await agendaStats(tx, p.from, p.to);
  const fin = await finance(tx, p.from, p.to, t);
  const clients = await clientStats(tx, p.from, p.to);
  const occ = await occupancy(tx, p.from, p.to < t ? p.to : t);       // o que já aconteceu
  const occFull = p.to > t ? await occupancy(tx, p.from, p.to) : occ; // período inteiro, inclui o que está agendado
  const sources = await funnel(tx, p.from, p.to);
  const porHora = occ.avail > 0 ? fin.revenue / (occ.avail / 60) : 0;
  const followers = sources.filter((s) => s.kind === 'instagram' && s.followers_last != null);
  return {
    agenda, fin, clients, occ, occFull, sources, porHora,
    seguidores: followers.reduce((n, s) => n + s.followers_last, 0),
    seguidoresGanho: followers.reduce((n, s) => n + (s.followers_last - s.followers_first), 0),
    previsto: fin.revenue + agenda.previsto,
  };
}
export type Snapshot = Awaited<ReturnType<typeof snapshot>>;

export type Insight = { text: string; tone?: 'up' | 'down'; href?: string; projection?: boolean };

/** Insights calculados com regras simples sobre os dados reais. Nada de IA, nada inventado. */
export async function insights(tx: Tx, p: Period, cur: Snapshot, t: string): Promise<Insight[]> {
  const out: Insight[] = [];
  const money = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  // período em andamento: compara só os dias já corridos com a mesma quantidade de dias antes
  const done = { ...p, to: p.to < t ? p.to : t };
  const [pf, pt] = previous(done);
  const prev = await finance(tx, pf, pt);
  if (prev.revenue > 0 && cur.fin.revenue > 0) {
    const d = ((cur.fin.revenue - prev.revenue) / prev.revenue) * 100;
    if (Math.abs(d) >= 1) out.push({ text: `Seu faturamento ${d > 0 ? 'aumentou' : 'caiu'} ${Math.abs(d).toFixed(0)}% em relação aos ${daysBetween(pf, pt) + 1} dias anteriores.`, tone: d > 0 ? 'up' : 'down' });
  }
  if (prev.ticket > 0 && cur.fin.ticket > 0 && Math.abs(cur.fin.ticket - prev.ticket) >= 1)
    out.push({ text: `Seu ticket médio ${cur.fin.ticket > prev.ticket ? 'aumentou' : 'caiu'} ${money(Math.abs(cur.fin.ticket - prev.ticket))}.`, tone: cur.fin.ticket > prev.ticket ? 'up' : 'down' });
  if (cur.agenda.cancelados) out.push({ text: `Você teve ${cur.agenda.cancelados} ${cur.agenda.cancelados === 1 ? 'cancelamento' : 'cancelamentos'} neste período.`, tone: 'down' });
  if (cur.agenda.faltas) out.push({ text: `${cur.agenda.faltas} ${cur.agenda.faltas === 1 ? 'cliente faltou' : 'clientes faltaram'} sem avisar.`, tone: 'down' });
  const idle = (await tx.one(
    `select count(*)::int n, coalesce(sum(a.price), 0)::float8 perdido from appointments a
     where a.status in ('cancelado', 'faltou') and a.${RANGE} and a.starts_at < now()
       and not exists (select from appointments x where x.barber_id = a.barber_id and x.status not in ('cancelado', 'faltou')
                         and tstzrange(x.starts_at, x.ends_at) && tstzrange(a.starts_at, a.ends_at))`, [p.from, p.to]))!;
  if (idle.n) out.push({ text: `${idle.n} ${idle.n === 1 ? 'horário ficou ocioso' : 'horários ficaram ociosos'} após cancelamento ou falta: ${money(idle.perdido)} que deixaram de entrar.`, tone: 'down' });
  if (cur.clients.fila) out.push({ text: `${cur.clients.fila === 1 ? 'Existe 1 cliente' : `Existem ${cur.clients.fila} clientes`} na fila de espera que ${cur.clients.fila === 1 ? 'pode' : 'podem'} ocupar horários vagos.`, href: '/fila' });
  const hoursRows = await tx.q<{ h: number; total: number }>(
    `select extract(hour from starts_at)::int h, sum(price)::float8 total from appointments where status = 'concluido' and ${RANGE} group by 1`, [p.from, p.to]);
  if (hoursRows.length >= 3) {
    const by = new Map(hoursRows.map((r) => [r.h, r.total]));
    let best = 0, bestSum = 0;
    for (let h = 0; h <= 21; h++) { const sum = (by.get(h) ?? 0) + (by.get(h + 1) ?? 0) + (by.get(h + 2) ?? 0); if (sum > bestSum) { bestSum = sum; best = h; } }
    out.push({ text: `Seu horário mais rentável é entre ${best}h e ${best + 3}h (${money(bestSum)} no período).` });
  }
  for (const s of cur.sources.filter((s) => s.novos > 0).sort((a, b) => b.novos - a.novos).slice(0, 2))
    out.push({ text: `${s.name} trouxe ${s.novos} ${s.novos === 1 ? 'novo cliente' : 'novos clientes'} neste período.`, tone: 'up', href: '/marketing' });
  if (cur.clients.inativos) out.push({ text: `${cur.clients.inativos} ${cur.clients.inativos === 1 ? 'cliente está inativo' : 'clientes estão inativos'}. Vale mandar uma mensagem.`, href: '/clientes?classe=inativo' });
  if (cur.occ.busy > 0 && cur.occ.pct < 90 && cur.fin.revenue > 0) {
    const extra = (cur.fin.byCategory.atendimento / (cur.occ.busy / 60)) * ((cur.occ.avail * 0.1) / 60);
    out.push({ text: `Se a ocupação subir 10 pontos (de ${cur.occ.pct.toFixed(0)}% para ${(cur.occ.pct + 10).toFixed(0)}%), o faturamento do período pode chegar a cerca de ${money(cur.fin.revenue + extra)}.`, projection: true });
  }
  if (cur.fin.revenue > 0 && cur.fin.profit < 0) out.push({ text: `Os custos do período (${money(cur.fin.costs)}) estão maiores que o faturamento.`, tone: 'down', href: '/financeiro' });
  return out;
}
