'use server';
import { z } from 'zod';
import { STAFF } from '@/lib/auth';
import { AppError, audit, run, v, type State } from '@/lib/action';
import { candidates, sendOffers, slotFromAppointment } from '@/lib/waitlist';

const addSchema = z.object({
  client_id: v.id.optional(), new_name: v.opt(80), new_phone: v.phone, service_id: v.id, barber_id: v.id.optional(),
  date: v.date, from: v.time, to: v.time, flex_minutes: v.int('a tolerância', 0, 240).default(0), priority: v.int('a prioridade', 0, 9).default(0), notes: v.opt(300),
});

export async function addWaiting(_: State, fd: FormData) {
  return run(STAFF, addSchema, fd, async (d, tx, s) => {
    if (d.to <= d.from) throw new AppError('O fim da janela precisa ser depois do início.');
    let clientId = d.client_id;
    if (!clientId) {
      if (!d.new_name) throw new AppError('Escolha um cliente ou informe o nome do novo cliente.');
      clientId = (await tx.one(`insert into clients (barbershop_id, name, phone) values (app_shop(), $1, $2) returning id`, [d.new_name, d.new_phone ?? null]))!.id;
    }
    const w = await tx.one(
      `insert into waiting_list (barbershop_id, client_id, service_id, barber_id, desired_date, window_start, window_end, flex_minutes, priority, notes)
       values (app_shop(), $1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [clientId, d.service_id, d.barber_id ?? null, d.date, d.from, d.to, d.flex_minutes, d.priority, d.notes ?? null]);
    await audit(tx, s, 'fila.entrada', 'waiting_list', w!.id);
    return { redirect: '/fila' };
  });
}

export async function removeWaiting(_: State, fd: FormData) {
  return run(STAFF, z.object({ id: v.id }), fd, async (d, tx, s) => {
    await tx.q(`update waiting_list set status = 'cancelado' where id = $1 and status = 'ativo'`, [d.id]);
    await tx.q(`update waiting_list_offers set status = 'expirou' where waiting_id = $1 and status = 'enviado'`, [d.id]);
    await audit(tx, s, 'fila.saida', 'waiting_list', d.id);
  });
}

/** Envia o convite de encaixe: para uma pessoa, para a primeira da fila ou para todas as compatíveis. */
export async function offerSlot(_: State, fd: FormData) {
  const schema = z.object({ slot: v.id, mode: z.enum(['um', 'primeiro', 'todos']), waiting_id: v.id.optional() });
  return run(STAFF, schema, fd, async (d, tx, s) => {
    const slot = await slotFromAppointment(tx, d.slot);
    if (!slot) throw new AppError('Este horário não está mais livre.');
    const list = (await candidates(tx, slot)).filter((c) => c.offer_status !== 'enviado' && c.offer_status !== 'recusou');
    const ids = d.mode === 'um' ? list.filter((c) => c.id === d.waiting_id).map((c) => c.id)
      : (d.mode === 'primeiro' ? list.slice(0, 1) : list).map((c) => c.id);
    if (!ids.length) throw new AppError('Ninguém da fila disponível para este convite.');
    await sendOffers(tx, s, slot, ids);
  });
}

/** O cliente respondeu por fora (WhatsApp, telefone): o atendente confirma e o horário é preenchido. */
export async function acceptOffer(_: State, fd: FormData) {
  return run(STAFF, z.object({ id: v.id }), fd, async (d, tx, s) => {
    const r = await tx.one(`select offer_accept($1) appt, (select starts_at::date::text from waiting_list_offers where id = $1) dia`, [d.id]);
    if (!r?.appt) throw new AppError('O horário já foi ocupado por outra pessoa.');
    await audit(tx, s, 'encaixe.confirmado', 'appointment', r.appt);
    return { redirect: `/agenda?d=${r.dia}` };
  });
}

export async function declineOffer(_: State, fd: FormData) {
  return run(STAFF, z.object({ id: v.id }), fd, async (d, tx, s) => {
    await tx.q(`update waiting_list_offers set status = 'recusou', responded_at = now() where id = $1 and status = 'enviado'`, [d.id]);
    await audit(tx, s, 'encaixe.recusado', 'offer', d.id);
  });
}

export async function readNotifications(_: State, _fd: FormData) {
  return run(STAFF, z.object({}), _fd, async (_d, tx) => { await tx.q(`update notifications set read_at = now() where read_at is null`); });
}
