import Link from 'next/link';
import { requireSession, STAFF } from '@/lib/auth';
import { withTenant } from '@/lib/db';
import { dmy, isUuid } from '@/lib/format';
import { today } from '@/lib/metrics';
import { candidates, expireOffers, slotFromAppointment } from '@/lib/waitlist';
import { ActionForm, Modal, Submit } from '@/components/ui';
import { lookups } from '@/components/client-form';
import { loadOffers, OfferList } from '@/components/offers';
import { addWaiting, removeWaiting } from './actions';

export default async function QueuePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const s = await requireSession(STAFF);
  const sp = await searchParams;
  const d = await withTenant(s, async (tx) => {
    await expireOffers(tx);
    const t = await today(tx);
    // horários que vagaram (cancelamento ou falta) e continuam livres
    const freed = await tx.q(`select id from appointments where status in ('cancelado', 'faltou') and starts_at > now() and starts_at < now() + interval '14 days' order by starts_at limit 40`);
    const open: { slot: any; n: number }[] = [];
    for (const f of freed) {
      const slot = await slotFromAppointment(tx, f.id);
      if (!slot || open.some((o) => o.slot.barber_id === slot.barber_id && o.slot.starts_at === slot.starts_at)) continue;
      const n = (await candidates(tx, slot)).filter((c) => c.offer_status !== 'recusou').length;
      if (n) open.push({ slot, n });
    }
    return {
      t, open, lk: await lookups(tx),
      queue: await tx.q(`select w.id, w.desired_date::text as date, w.window_start::text de, w.window_end::text ate, w.flex_minutes, w.priority, w.notes,
                                c.id client_id, c.name client, c.phone, sv.name service, b.name barber
                         from waiting_list w join clients c on c.id = w.client_id join services sv on sv.id = w.service_id left join barbers b on b.id = w.barber_id
                         where w.status = 'ativo' and w.desired_date >= current_date order by w.desired_date, w.priority desc, w.created_at`),
      offers: await loadOffers(tx, `o.created_at > now() - interval '2 days'`, []),
      clients: await tx.q(`select id, name, phone from clients order by name limit 1000`),
    };
  });
  const preC = isUuid(sp.c) ? sp.c : '';
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Fila de espera</h1><p>{d.queue.length} {d.queue.length === 1 ? 'pessoa esperando' : 'pessoas esperando'} um horário.</p></div>
        <Modal label="Colocar na fila" title="Colocar na fila de espera" className="btn btn-primary" open={sp.novo === '1'}>
          {d.lk.services.length ? (
            <ActionForm action={addWaiting}>
              <label className="field"><span>Cliente</span><select name="client_id" defaultValue={preC}><option value="">Novo cliente (preencha abaixo)</option>{d.clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? `, ${c.phone}` : ''}</option>)}</select></label>
              <div className="form-2">
                <label className="field"><span>Nome do novo cliente</span><input name="new_name" maxLength={80} /></label>
                <label className="field"><span>Telefone</span><input name="new_phone" inputMode="tel" /></label>
                <label className="field"><span>Serviço desejado</span><select name="service_id" required>{d.lk.services.map((x) => <option key={x.id} value={x.id}>{x.name}, {x.duration_min} min</option>)}</select></label>
                <label className="field"><span>Barbeiro preferido</span><select name="barber_id"><option value="">Qualquer um</option>{d.lk.barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              </div>
              <label className="field"><span>Dia desejado</span><input type="date" name="date" defaultValue={d.t} min={d.t} required /></label>
              <div className="form-2">
                <label className="field"><span>Pode a partir das</span><input type="time" name="from" defaultValue="17:00" required /></label>
                <label className="field"><span>Até as</span><input type="time" name="to" defaultValue="20:00" required /></label>
                <label className="field"><span>Flexibilidade de horário</span><select name="flex_minutes"><option value="0">Só nessa janela</option><option value="30">Até 30 min antes ou depois</option><option value="60">Até 1 hora antes ou depois</option><option value="120">Até 2 horas antes ou depois</option></select></label>
                <label className="field"><span>Prioridade</span><select name="priority"><option value="0">Normal</option><option value="5">Alta</option><option value="9">Máxima</option></select></label>
              </div>
              <label className="field"><span>Observações</span><input name="notes" maxLength={300} /></label>
              <Submit>Colocar na fila</Submit>
            </ActionForm>
          ) : <p>Cadastre um <Link href="/servicos">serviço</Link> antes de usar a fila.</p>}
        </Modal>
      </div>

      {d.open.map(({ slot, n }) => (
        <p className="notice" key={slot.id}>
          <strong>Horário livre: {slot.date === d.t ? 'hoje' : slot.day} às {slot.hour} com {slot.barber}.</strong>{' '}
          {n === 1 ? 'Encontramos 1 pessoa na fila que pode ocupar.' : `Encontramos ${n} pessoas na fila que podem ocupar.`}{' '}
          <Link href={`/fila/vaga/${slot.id}`}>Ver e enviar encaixe</Link>
        </p>
      ))}

      <div className="grid cols-main">
        <section className="card"><h2>Quem está esperando</h2>
          <div className="list">
            {d.queue.map((w) => (
              <div className="item" key={w.id}>
                <span className="when">{w.date === d.t ? 'Hoje' : dmy(w.date)}</span>
                <span className="grow"><Link href={`/clientes/${w.client_id}`}><strong>{w.client}</strong></Link>{w.priority > 0 && <span className="badge b-vip"> prioridade</span>}<br />
                  <span className="muted small">{w.service} · {w.de.slice(0, 5)} às {w.ate.slice(0, 5)}{w.flex_minutes > 0 && ` (±${w.flex_minutes} min)`} · {w.barber ?? 'qualquer barbeiro'}{w.notes && ` · ${w.notes}`}</span></span>
                <ActionForm action={removeWaiting} className=""><input type="hidden" name="id" value={w.id} /><Submit className="btn btn-sm">Tirar da fila</Submit></ActionForm>
              </div>
            ))}
            {!d.queue.length && <p className="empty">Ninguém na fila. Quando não houver horário para um cliente, coloque-o aqui: se alguém cancelar, o sistema avisa quem pode ocupar a vaga.</p>}
          </div>
        </section>
        <section className="card"><h2>Convites de encaixe</h2>
          {d.offers.length ? <OfferList offers={d.offers} /> : <p className="empty">Nenhum convite nos últimos dois dias.</p>}
        </section>
      </div>
    </div>
  );
}
