'use server';
import { z } from 'zod';
import { ADMIN } from '@/lib/auth';
import { audit, run, v, type State } from '@/lib/action';

const schema = z.object({
  id: v.id.optional(), name: v.text('o nome'), price: v.money('o preço'), duration_min: v.int('a duração', 5, 480),
  commission_pct: v.pct.optional(), barbers: z.array(v.id).max(100).default([]),
});

export async function saveService(_: State, fd: FormData) {
  return run(ADMIN, schema, fd, async (d, tx, s) => {
    const args = [d.name, d.price, d.duration_min, d.commission_pct ?? null];
    const row = d.id
      ? await tx.one(`update services set name=$2, price=$3, duration_min=$4, commission_pct=$5 where id=$1 returning id`, [d.id, ...args])
      : await tx.one(`insert into services (barbershop_id, name, price, duration_min, commission_pct) values (app_shop(), $1,$2,$3,$4) returning id`, args);
    if (!row) return;
    await tx.q(`delete from barber_services where service_id = $1`, [row.id]);
    await tx.q(`insert into barber_services (barbershop_id, barber_id, service_id) select app_shop(), b, $1 from unnest($2::uuid[]) b`, [row.id, d.barbers]);
    await audit(tx, s, d.id ? 'servico.alterado' : 'servico.criado', 'service', row.id, { preco: d.price });
  });
}

export async function toggleService(_: State, fd: FormData) {
  return run(ADMIN, z.object({ id: v.id }), fd, async (d, tx, s) => {
    await tx.q(`update services set active = not active where id = $1`, [d.id]);
    await audit(tx, s, 'servico.ativado_ou_desativado', 'service', d.id);
  });
}
