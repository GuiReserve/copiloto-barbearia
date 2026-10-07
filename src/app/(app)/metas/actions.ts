'use server';
import { z } from 'zod';
import { ADMIN } from '@/lib/auth';
import { run, v, type State } from '@/lib/action';

const METRICS = ['faturamento', 'clientes', 'novos_clientes', 'ticket_medio', 'ocupacao', 'seguidores', 'agendamentos', 'receita_hora'] as const;

export async function saveGoal(_: State, fd: FormData) {
  const schema = z.object({ metric: z.enum(METRICS), target: v.money('a meta').refine((n) => n > 0, 'A meta precisa ser maior que zero.'), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido.') });
  return run(ADMIN, schema, fd, async (d, tx) => {
    await tx.q(`insert into goals (barbershop_id, metric, target, month) values (app_shop(), $1, $2, $3::date)
                on conflict (barbershop_id, metric, month) do update set target = excluded.target`, [d.metric, d.target, `${d.month}-01`]);
  });
}
export async function removeGoal(_: State, fd: FormData) {
  return run(ADMIN, z.object({ id: v.id }), fd, async (d, tx) => { await tx.q(`delete from goals where id = $1`, [d.id]); });
}
