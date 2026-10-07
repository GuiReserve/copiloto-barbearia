'use server';
import { z } from 'zod';
import { ADMIN } from '@/lib/auth';
import { AppError, audit, run, v, type State } from '@/lib/action';
import type { Tx } from '@/lib/db';

const schema = z.object({
  id: v.id.optional(), name: v.text('o nome'), specialties: v.opt(200),
  photo_url: z.url('Link da foto inválido.').startsWith('https://', 'O link da foto precisa começar com https://').max(500).optional(),
  commission_pct: v.pct.default(0), monthly_goal: v.money('a meta').optional(), services: z.array(v.id).max(200).default([]),
});

export async function saveBarber(_: State, fd: FormData) {
  return run(ADMIN, schema, fd, async (d, tx, s) => {
    const args = [d.name, d.specialties ?? null, d.photo_url ?? null, d.commission_pct, d.monthly_goal ?? null];
    const row = d.id
      ? await tx.one(`update barbers set name=$2, specialties=$3, photo_url=$4, commission_pct=$5, monthly_goal=$6 where id=$1 returning id`, [d.id, ...args])
      : await tx.one(`insert into barbers (barbershop_id, name, specialties, photo_url, commission_pct, monthly_goal) values (app_shop(), $1,$2,$3,$4,$5) returning id`, args);
    if (!row) return;
    await tx.q(`delete from barber_services where barber_id = $1`, [row.id]);
    await tx.q(`insert into barber_services (barbershop_id, barber_id, service_id) select app_shop(), $1, x from unnest($2::uuid[]) x`, [row.id, d.services]);
    await audit(tx, s, d.id ? 'barbeiro.alterado' : 'barbeiro.criado', 'barber', row.id);
  });
}

export async function toggleBarber(_: State, fd: FormData) {
  return run(ADMIN, z.object({ id: v.id }), fd, async (d, tx, s) => {
    await tx.q(`update barbers set active = not active where id = $1`, [d.id]);
    await audit(tx, s, 'barbeiro.ativado_ou_desativado', 'barber', d.id);
  });
}

const t = v.time.optional();
const day = (i: number) => ({ [`on${i}`]: z.string().optional(), [`opens${i}`]: t, [`closes${i}`]: t, [`bs${i}`]: t, [`be${i}`]: t });
const hoursSchema = z.object({ barber_id: v.id.optional(), ...Object.assign({}, ...[0, 1, 2, 3, 4, 5, 6].map(day)) });

/** Grava o expediente da barbearia (sem barber_id) ou o horário individual de um barbeiro. */
async function writeHours(tx: Tx, d: Record<string, any>) {
  const barber = d.barber_id ?? null;
  await tx.q(`delete from work_hours where barber_id is not distinct from $1`, [barber]);
  for (let i = 0; i < 7; i++) {
    if (!d[`on${i}`]) continue;
    const [o, c, bs, be] = [d[`opens${i}`], d[`closes${i}`], d[`bs${i}`], d[`be${i}`]];
    if (!o || !c || c <= o) throw new AppError('Em cada dia marcado, o fechamento precisa ser depois da abertura.');
    if ((bs && !be) || (!bs && be) || (bs && (be <= bs || bs < o || be > c))) throw new AppError('O intervalo precisa ter início e fim dentro do expediente.');
    await tx.q(`insert into work_hours (barbershop_id, barber_id, weekday, opens, closes, break_start, break_end) values (app_shop(), $1,$2,$3,$4,$5,$6)`,
      [barber, i, o, c, bs ?? null, be ?? null]);
  }
}

export async function saveHours(_: State, fd: FormData) {
  return run(ADMIN, hoursSchema, fd, async (d, tx, s) => {
    await writeHours(tx, d);
    await audit(tx, s, 'horarios.alterados', 'barber', (d as any).barber_id);
  });
}

export async function clearBarberHours(_: State, fd: FormData) {
  return run(ADMIN, z.object({ barber_id: v.id }), fd, async (d, tx) => {
    await tx.q(`delete from work_hours where barber_id = $1`, [d.barber_id]);
  });
}
