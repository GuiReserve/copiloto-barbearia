import 'server-only';
import type { Tx } from './db';
import { addDays, daysBetween, toMin, weekday } from './format';

export type Interval = [number, number]; // minutos desde 00:00

export function subtract(list: Interval[], cut: Interval): Interval[] {
  const out: Interval[] = [];
  for (const [a, b] of list) {
    if (cut[1] <= a || cut[0] >= b) { out.push([a, b]); continue; }
    if (cut[0] > a) out.push([a, cut[0]]);
    if (cut[1] < b) out.push([cut[1], b]);
  }
  return out;
}
export const total = (list: Interval[]) => list.reduce((s, [a, b]) => s + (b - a), 0);

/** Expediente de cada barbeiro em cada dia, já sem intervalo, folgas, feriados e bloqueios. */
export async function availability(tx: Tx, from: string, to: string, onlyBarber?: string | null) {
  const days = Math.min(daysBetween(from, to), 370);
  const barbers = await tx.q<{ id: string }>(
    `select id from barbers where active and ($1::uuid is null or id = $1) order by name`, [onlyBarber ?? null]);
  const wh = await tx.q(`select barber_id, weekday, opens::text, closes::text, break_start::text, break_end::text from work_hours`);
  const blocks = await tx.q(
    `select barber_id, to_char(starts_at, 'YYYY-MM-DD') sd, (extract(hour from starts_at) * 60 + extract(minute from starts_at))::int sm,
            to_char(ends_at, 'YYYY-MM-DD') ed, (extract(hour from ends_at) * 60 + extract(minute from ends_at))::int em
     from time_blocks where starts_at < ($2::date + 1) and ends_at > $1::date`, [from, to]);
  const own = new Set(wh.filter((w) => w.barber_id).map((w) => w.barber_id));
  const out = new Map<string, Map<string, Interval[]>>();
  for (let i = 0; i <= days; i++) {
    const d = addDays(from, i), wd = weekday(d), per = new Map<string, Interval[]>();
    for (const b of barbers) {
      const row = wh.find((w) => w.weekday === wd && w.barber_id === (own.has(b.id) ? b.id : null));
      let list: Interval[] = row ? [[toMin(row.opens), toMin(row.closes)]] : [];
      if (row?.break_start) list = subtract(list, [toMin(row.break_start), toMin(row.break_end)]);
      for (const k of blocks) {
        if ((k.barber_id && k.barber_id !== b.id) || k.sd > d || k.ed < d) continue;
        list = subtract(list, [k.sd < d ? 0 : k.sm, k.ed > d ? 1440 : k.em]);
      }
      per.set(b.id, list);
    }
    out.set(d, per);
  }
  return out;
}

export async function availableMinutes(tx: Tx, from: string, to: string, barberId?: string | null) {
  if (to < from) return 0;
  let sum = 0;
  for (const per of (await availability(tx, from, to, barberId)).values()) for (const l of per.values()) sum += total(l);
  return sum;
}

export async function busyMinutes(tx: Tx, from: string, to: string, barberId?: string | null) {
  const r = await tx.one<{ m: number }>(
    `select coalesce(sum(extract(epoch from ends_at - starts_at) / 60), 0)::float8 m from appointments
     where status not in ('cancelado', 'faltou') and starts_at >= $1::date and starts_at < ($2::date + 1)
       and ($3::uuid is null or barber_id = $3)`, [from, to, barberId ?? null]);
  return r?.m ?? 0;
}

export async function occupancy(tx: Tx, from: string, to: string, barberId?: string | null) {
  const [avail, busy] = [await availableMinutes(tx, from, to, barberId), await busyMinutes(tx, from, to, barberId)];
  return { avail, busy, idle: Math.max(0, avail - busy), pct: avail > 0 ? Math.min(100, (busy / avail) * 100) : 0 };
}

/** Janelas livres de um dia por barbeiro (expediente menos atendimentos ativos). */
export async function freeByBarber(tx: Tx, date: string, barberId?: string | null) {
  const work = (await availability(tx, date, date, barberId)).get(date)!;
  const appts = await tx.q(
    `select barber_id, (extract(hour from starts_at) * 60 + extract(minute from starts_at))::int a,
            (extract(epoch from ends_at - starts_at) / 60)::int len
     from appointments where status not in ('cancelado', 'faltou') and starts_at >= $1::date and starts_at < ($1::date + 1)`, [date]);
  const now = await tx.one<{ today: string; m: number }>(
    `select current_date::text today, (extract(hour from now()) * 60 + extract(minute from now()))::int m`);
  const free = new Map<string, Interval[]>();
  for (const [b, list] of work) {
    let l = list;
    for (const a of appts) if (a.barber_id === b) l = subtract(l, [a.a, a.a + a.len]);
    if (date < now!.today) l = [];
    if (date === now!.today) l = subtract(l, [0, now!.m]);
    free.set(b, l);
  }
  return { work, free };
}

/** Horários de início possíveis para um serviço com a duração dada. */
export function startTimes(free: Interval[], duration: number, step: number): number[] {
  const out: number[] = [];
  for (const [a, b] of free) for (let t = Math.ceil(a / step) * step; t + duration <= b; t += step) out.push(t);
  return out;
}
