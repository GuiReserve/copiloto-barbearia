'use server';
import { z } from 'zod';
import { ADMIN } from '@/lib/auth';
import { audit, run, v, type State } from '@/lib/action';
import { CATEGORIAS } from '@/lib/format';

const CATS = Object.keys(CATEGORIAS).filter((c) => c !== 'atendimento') as [string, ...string[]];

export async function addExpense(_: State, fd: FormData) {
  const schema = z.object({ category: z.enum(CATS), description: v.opt(120), amount: v.money().refine((n) => n > 0, 'Informe um valor maior que zero.'), date: v.date });
  return run(ADMIN, schema, fd, async (d, tx, s) => {
    const r = await tx.one(`insert into expenses (barbershop_id, category, description, amount, spent_on) values (app_shop(), $1,$2,$3,$4) returning id`, [d.category, d.description ?? null, d.amount, d.date]);
    await audit(tx, s, 'despesa.criada', 'expense', r!.id, { valor: d.amount });
  });
}
export async function addFixedCost(_: State, fd: FormData) {
  const schema = z.object({ category: z.enum(CATS), name: v.text('o nome'), amount: v.money().refine((n) => n > 0, 'Informe um valor maior que zero.'), starts_on: v.date });
  return run(ADMIN, schema, fd, async (d, tx, s) => {
    const r = await tx.one(`insert into fixed_costs (barbershop_id, category, name, amount, starts_on) values (app_shop(), $1,$2,$3,$4) returning id`, [d.category, d.name, d.amount, d.starts_on]);
    await audit(tx, s, 'custo_fixo.criado', 'fixed_cost', r!.id, { valor: d.amount });
  });
}
export async function addRevenue(_: State, fd: FormData) {
  const schema = z.object({ category: z.enum(['produtos', 'outros']), description: v.opt(120), amount: v.money().refine((n) => n > 0, 'Informe um valor maior que zero.'), date: v.date, barber_id: v.id.optional() });
  return run(ADMIN, schema, fd, async (d, tx, s) => {
    const r = await tx.one(`insert into revenues (barbershop_id, category, description, amount, received_on, barber_id) values (app_shop(), $1,$2,$3,$4,$5) returning id`,
      [d.category, d.description ?? null, d.amount, d.date, d.barber_id ?? null]);
    await audit(tx, s, 'receita.criada', 'revenue', r!.id, { valor: d.amount });
  });
}
export async function removeEntry(_: State, fd: FormData) {
  return run(ADMIN, z.object({ id: v.id, kind: z.enum(['expense', 'revenue', 'fixed', 'fixed_end']) }), fd, async (d, tx, s) => {
    if (d.kind === 'expense') await tx.q(`delete from expenses where id = $1`, [d.id]);
    if (d.kind === 'revenue') await tx.q(`delete from revenues where id = $1 and appointment_id is null`, [d.id]);
    if (d.kind === 'fixed') await tx.q(`delete from fixed_costs where id = $1`, [d.id]);
    if (d.kind === 'fixed_end') await tx.q(`update fixed_costs set ends_on = (date_trunc('month', current_date) - interval '1 day')::date where id = $1`, [d.id]);
    await audit(tx, s, `financeiro.${d.kind}.removido`, d.kind, d.id);
  });
}
