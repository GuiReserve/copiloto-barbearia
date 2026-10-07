'use server';
import { z } from 'zod';
import { ALL, STAFF } from '@/lib/auth';
import { AppError, audit, run, v, type State } from '@/lib/action';
import type { Tx } from '@/lib/db';
import { freeByBarber } from '@/lib/slots';
import { hm, toMin } from '@/lib/format';
import { candidates, sendOffers, slotFromAppointment } from '@/lib/waitlist';

/** Confere se o serviço cabe em uma janela livre do barbeiro. O banco ainda barra sobreposição por conta própria. */
async function assertFits(tx: Tx, barberId: string, serviceId: string, date: string, time: string, force: boolean, ignoreId?: string) {
  const sv = await tx.one(`select s.duration_min, s.price::float8 price, exists (select from barber_services where barber_id = $2 and service_id = s.id) faz
                           from services s where s.id = $1 and s.active`, [serviceId, barberId]);
  if (!sv) throw new AppError('Serviço não encontrado.');
  if (!sv.faz) throw new AppError('Este barbeiro não faz este serviço. Ajuste em Serviços ou escolha outro barbeiro.');
  if (!force) {
    let { free } = await freeByBarber(tx, date, barberId);
    let list = free.get(barberId) ?? [];
    if (ignoreId) { // reagendando: o horário atual do próprio atendimento conta como livre
      const cur = await tx.one(`select (extract(hour from starts_at) * 60 + extract(minute from starts_at))::int a, (extract(epoch from ends_at - starts_at) / 60)::int len
                                from appointments where id = $1 and starts_at::date = $2::date and barber_id = $3`, [ignoreId, date, barberId]);
      if (cur) list = [...list, [cur.a, cur.a + cur.len] as [number, number]].sort((x, y) => x[0] - y[0])
        .reduce<[number, number][]>((acc, i) => (acc.length && acc.at(-1)![1] >= i[0] ? (acc.at(-1)![1] = Math.max(acc.at(-1)![1], i[1]), acc) : [...acc, i]), []);
    }
    const t = toMin(time);
    if (!list.some(([a, b]) => t >= a && t + sv.duration_min <= b)) {
      const options = list.filter(([a, b]) => b - a >= sv.duration_min).map(([a, b]) => `${hm(a)} a ${hm(b - sv.duration_min)}`);
      throw new AppError(options.length
        ? `Às ${time} não cabe (${sv.duration_min} min). Inícios livres neste dia: ${options.join(', ')}. Para forçar, marque "Encaixe".`
        : 'Sem horário livre para este barbeiro neste dia. Coloque o cliente na fila de espera ou marque "Encaixe" para forçar.');
    }
  }
  return sv as { duration_min: number; price: number };
}

const createSchema = z.object({
  client_id: v.id.optional(), new_name: v.opt(80), new_phone: v.phone, source_id: v.id.optional(),
  service_id: v.id, barber_id: v.id, date: v.date, time: v.time, notes: v.opt(500), force: z.string().optional(),
});

export async function createAppointment(_: State, fd: FormData) {
  return run(STAFF, createSchema, fd, async (d, tx, s) => {
    const sv = await assertFits(tx, d.barber_id, d.service_id, d.date, d.time, !!d.force);
    let clientId = d.client_id, sourceId = d.source_id ?? null;
    if (!clientId) {
      if (!d.new_name) throw new AppError('Escolha um cliente ou informe o nome do novo cliente.');
      clientId = (await tx.one(`insert into clients (barbershop_id, name, phone, source_id, preferred_barber_id) values (app_shop(), $1,$2,$3,$4) returning id`,
        [d.new_name, d.new_phone ?? null, sourceId, d.barber_id]))!.id;
    } else if (!sourceId) {
      sourceId = (await tx.one(`select source_id from clients where id = $1`, [clientId]))?.source_id ?? null;
    }
    const a = await tx.one(
      `insert into appointments (barbershop_id, client_id, barber_id, service_id, source_id, starts_at, ends_at, status, price, notes, created_by)
       values (app_shop(), $1,$2,$3,$4, ($5::date + $6::time)::timestamptz, ($5::date + $6::time)::timestamptz + make_interval(mins => $7), $8, $9, $10, app_user()) returning id`,
      [clientId, d.barber_id, d.service_id, sourceId, d.date, d.time, sv.duration_min, d.force ? 'encaixado' : 'agendado', sv.price, d.notes ?? null]);
    await audit(tx, s, 'agendamento.criado', 'appointment', a!.id);
    return { redirect: `/agenda?d=${d.date}` };
  });
}

const updateSchema = z.object({ id: v.id, service_id: v.id, barber_id: v.id, date: v.date, time: v.time, price: v.money('o valor'), notes: v.opt(500), force: z.string().optional() });

/** Editar e reagendar. */
export async function updateAppointment(_: State, fd: FormData) {
  return run(STAFF, updateSchema, fd, async (d, tx, s) => {
    const sv = await assertFits(tx, d.barber_id, d.service_id, d.date, d.time, !!d.force, d.id);
    const r = await tx.one(
      `update appointments set service_id=$2, barber_id=$3, starts_at=($4::date + $5::time)::timestamptz,
              ends_at=($4::date + $5::time)::timestamptz + make_interval(mins => $6), price=$7, notes=$8
       where id=$1 and status not in ('cancelado', 'concluido', 'faltou') returning id`,
      [d.id, d.service_id, d.barber_id, d.date, d.time, sv.duration_min, d.price, d.notes ?? null]);
    if (!r) throw new AppError('Este agendamento não pode mais ser alterado.');
    await audit(tx, s, 'agendamento.alterado', 'appointment', d.id, { dia: d.date, hora: d.time });
    return { redirect: `/agenda?d=${d.date}` };
  });
}

const NEXT: Record<string, string[]> = {
  confirmado: ['agendado', 'encaixado'],
  em_atendimento: ['agendado', 'confirmado', 'encaixado'],
  concluido: ['agendado', 'confirmado', 'encaixado', 'em_atendimento'],
  faltou: ['agendado', 'confirmado', 'encaixado'],
  agendado: ['concluido', 'faltou', 'confirmado', 'em_atendimento'], // desfazer
};

export async function setStatus(_: State, fd: FormData) {
  return run(ALL, z.object({ id: v.id, status: z.enum(['confirmado', 'em_atendimento', 'concluido', 'faltou', 'agendado']) }), fd, async (d, tx, s) => {
    const r = await tx.one(`update appointments set status = $2 where id = $1 and status = any($3::text[]) returning id`, [d.id, d.status, NEXT[d.status]]);
    if (!r) throw new AppError('Não foi possível mudar a situação deste atendimento.');
    await audit(tx, s, `agendamento.${d.status}`, 'appointment', d.id);
  });
}

/** Cancelar libera o horário e já olha a fila: é aqui que começa o encaixe. */
export async function cancelAppointment(_: State, fd: FormData) {
  return run(STAFF, z.object({ id: v.id }), fd, async (d, tx, s) => {
    const r = await tx.one(`update appointments set status = 'cancelado', cancelled_at = now()
                            where id = $1 and status not in ('cancelado', 'concluido') returning id`, [d.id]);
    if (!r) throw new AppError('Este agendamento já foi cancelado ou concluído.');
    await audit(tx, s, 'agendamento.cancelado', 'appointment', d.id);
    const slot = await slotFromAppointment(tx, d.id);
    if (!slot) return;
    const list = (await candidates(tx, slot)).filter((c) => !c.offer_status);
    const mode = (await tx.one(`select auto_offer from settings`))!.auto_offer;
    if (list.length && mode !== 'manual') await sendOffers(tx, s, slot, (mode === 'primeiro' ? list.slice(0, 1) : list).map((c) => c.id));
    return { redirect: `/fila/vaga/${d.id}` };
  });
}
