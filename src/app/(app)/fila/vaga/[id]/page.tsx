import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession, STAFF } from '@/lib/auth';
import { withTenant } from '@/lib/db';
import { brl, isUuid } from '@/lib/format';
import { today } from '@/lib/metrics';
import { candidates, expireOffers, slotFromAppointment } from '@/lib/waitlist';
import { ActionForm, Submit } from '@/components/ui';
import { loadOffers, OfferList } from '@/components/offers';
import { offerSlot } from '../../actions';

export default async function FreedSlotPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession(STAFF);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const d = await withTenant(s, async (tx) => {
    await expireOffers(tx);
    const base = await tx.one(`select a.barber_id, a.starts_at::text, a.starts_at::date::text as date, to_char(a.starts_at, 'HH24:MI') as hour, to_char(a.starts_at, 'DD/MM') as day, c.name client
                               from appointments a join clients c on c.id = a.client_id where a.id = $1`, [id]);
    if (!base) return null;
    const slot = await slotFromAppointment(tx, id);
    return {
      base, slot, t: await today(tx),
      list: slot ? await candidates(tx, slot) : [],
      offers: await loadOffers(tx, `o.barber_id = $1 and o.starts_at = $2::timestamptz`, [base.barber_id, base.starts_at]),
    };
  });
  if (!d) notFound();
  const { slot, base } = d;
  const when = `${base.date === d.t ? 'hoje' : base.day} às ${base.hour}`;
  const free = d.list.filter((c) => !c.offer_status || c.offer_status === 'expirou');
  return (
    <div className="stack">
      <div className="page-head"><div><p className="small"><Link href="/fila">Fila de espera</Link></p>
        <h1>{slot ? `Horário liberado: ${when}` : `Horário de ${when}`}</h1>
        <p>{slot ? `${base.client} cancelou. Vaga com ${slot.barber}, ${slot.len} minutos.` : 'Este horário já foi ocupado ou já passou.'}</p></div>
        <Link className="btn" href={`/agenda?d=${base.date}`}>Ver agenda do dia</Link>
      </div>

      {slot && (
        <section className="card stack">
          <div className="row between">
            <h2>{d.list.length ? (d.list.length === 1 ? 'Encontramos 1 pessoa na fila.' : `Encontramos ${d.list.length} pessoas na fila.`) : 'Ninguém na fila para este horário.'}</h2>
            {free.length > 0 && <div className="row">
              <ActionForm action={offerSlot} className=""><input type="hidden" name="slot" value={slot.id} /><input type="hidden" name="mode" value="primeiro" /><Submit>Enviar encaixe para {free[0].name.split(' ')[0]}</Submit></ActionForm>
              {free.length > 1 && <ActionForm action={offerSlot} className=""><input type="hidden" name="slot" value={slot.id} /><input type="hidden" name="mode" value="todos" /><Submit className="btn">Enviar para os {free.length}</Submit></ActionForm>}
            </div>}
          </div>
          <div className="list">
            {d.list.map((c, i) => (
              <div className="item" key={c.id}>
                <span className="when">{i + 1}º</span>
                <span className="grow"><strong>{c.name}</strong>{c.priority > 0 && <span className="badge b-vip"> prioridade</span>}<br />
                  <span className="muted small">{c.service}, {c.duration_min} min, {brl(c.price)} · pode das {c.window_start.slice(0, 5)} às {c.window_end.slice(0, 5)}{c.pediu_barbeiro && ' · pediu este barbeiro'}</span></span>
                {(!c.offer_status || c.offer_status === 'expirou')
                  ? <ActionForm action={offerSlot} className=""><input type="hidden" name="slot" value={slot.id} /><input type="hidden" name="mode" value="um" /><input type="hidden" name="waiting_id" value={c.id} /><Submit className="btn btn-sm">Enviar encaixe</Submit></ActionForm>
                  : <span className={`badge b-${c.offer_status}`}>{c.offer_status === 'enviado' ? 'Convite enviado' : 'Recusou'}</span>}
              </div>
            ))}
            {!d.list.length && <p className="empty">O horário fica aberto na agenda. Você pode agendar outro cliente normalmente.</p>}
          </div>
        </section>
      )}

      {d.offers.length > 0 && <section className="card"><h2>Convites deste horário</h2><OfferList offers={d.offers} /></section>}
    </div>
  );
}
