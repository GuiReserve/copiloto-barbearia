import 'server-only';
import { randomBytes } from 'node:crypto';
import type { Tx } from './db';
import { hashToken, type Session } from './auth';
import { audit } from './action';
import { createMessage } from '@/integrations/messaging';

export const appUrl = () =>
  (process.env.APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000')).replace(/\/$/, '');

export type Slot = { id: string; barber_id: string; barber: string; day: string; date: string; hour: string; start_min: number; len: number; starts_at: string; ends_at: string };

/** O horário liberado por um atendimento cancelado (ou marcado como falta). */
export async function slotFromAppointment(tx: Tx, appointmentId: string) {
  return tx.one<Slot>(
    `select a.id, a.barber_id, b.name barber, to_char(a.starts_at, 'DD/MM') as day, a.starts_at::date::text as date,
            to_char(a.starts_at, 'HH24:MI') as hour, (extract(hour from a.starts_at) * 60 + extract(minute from a.starts_at))::int start_min,
            (extract(epoch from a.ends_at - a.starts_at) / 60)::int len, a.starts_at::text, a.ends_at::text
     from appointments a join barbers b on b.id = a.barber_id
     where a.id = $1 and a.status in ('cancelado', 'faltou') and a.starts_at > now()
       and not exists (select from appointments x where x.barber_id = a.barber_id and x.status not in ('cancelado', 'faltou')
                         and tstzrange(x.starts_at, x.ends_at) && tstzrange(a.starts_at, a.ends_at))`, [appointmentId]);
}

/**
 * Quem da fila pode ocupar o horário. Regras de prioridade, nesta ordem:
 * prioridade manual → pediu este barbeiro → chegou primeiro na fila.
 * Só entra quem: quer este dia, cabe na janela de horário (com a tolerância informada),
 * tem um serviço que cabe no tempo livre e que o barbeiro faz.
 */
export async function candidates(tx: Tx, slot: Slot) {
  return tx.q(
    `select w.id, c.id client_id, c.name, c.phone, s.name service, s.duration_min, s.price::float8 price,
            w.window_start::text, w.window_end::text, w.priority, w.notes, (w.barber_id is not null) pediu_barbeiro,
            (select o.status from waiting_list_offers o where o.waiting_id = w.id and o.barber_id = $1 and o.starts_at = $2::timestamptz
              order by o.created_at desc limit 1) offer_status
     from waiting_list w join clients c on c.id = w.client_id join services s on s.id = w.service_id
     where w.status = 'ativo' and w.desired_date = $3::date
       and (w.barber_id is null or w.barber_id = $1)
       and exists (select from barber_services bs where bs.barber_id = $1 and bs.service_id = w.service_id)
       and s.duration_min <= $5
       and $4 >= extract(hour from w.window_start) * 60 + extract(minute from w.window_start) - w.flex_minutes
       and $4 + s.duration_min <= extract(hour from w.window_end) * 60 + extract(minute from w.window_end) + w.flex_minutes
     order by w.priority desc, (w.barber_id is not null) desc, w.created_at`,
    [slot.barber_id, slot.starts_at, slot.date, slot.start_min, slot.len]);
}

/** Cria o convite, registra e gera a mensagem de encaixe para cada pessoa escolhida. */
export async function sendOffers(tx: Tx, s: Session, slot: Slot, waitingIds: string[]) {
  const st = (await tx.one(`select offer_expiry_minutes from settings`))!;
  let sent = 0;
  for (const wid of waitingIds.slice(0, 10)) {
    const w = await tx.one(`select w.client_id, sv.name service from waiting_list w join services sv on sv.id = w.service_id where w.id = $1 and w.status = 'ativo'`, [wid]);
    const dup = await tx.one(`select 1 from waiting_list_offers where waiting_id = $1 and barber_id = $2 and starts_at = $3::timestamptz and status = 'enviado' and expires_at > now()`, [wid, slot.barber_id, slot.starts_at]);
    if (!w || dup) continue;
    const token = randomBytes(32).toString('base64url');
    const o = (await tx.one(
      `insert into waiting_list_offers (barbershop_id, waiting_id, barber_id, starts_at, ends_at, origin_appointment_id, token_hash, expires_at)
       values ($1,$2,$3,$4::timestamptz,$5::timestamptz,$6,$7, least(now() + make_interval(mins => $8), $4::timestamptz)) returning id`,
      [s.shopId, wid, slot.barber_id, slot.starts_at, slot.ends_at, slot.id, hashToken(token), st.offer_expiry_minutes]))!;
    await createMessage(tx, s, {
      clientId: w.client_id, kind: 'encaixe', offerId: o.id,
      vars: { data: slot.day, horario: slot.hour, barbeiro: slot.barber, servico: w.service, link: `${appUrl()}/o/${token}` },
    });
    await audit(tx, s, 'encaixe.convite_enviado', 'offer', o.id);
    sent++;
  }
  return sent;
}

export async function expireOffers(tx: Tx) {
  await tx.q(`update waiting_list_offers set status = 'expirou' where status = 'enviado' and expires_at < now()`);
}
