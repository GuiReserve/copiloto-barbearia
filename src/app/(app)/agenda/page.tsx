import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { withTenant } from '@/lib/db';
import { addDays, addMonths, brl, DIAS_CURTOS, hm, isDate, isUuid, longDate, monthEnd, monthName, monthStart, STATUS, weekday } from '@/lib/format';
import { freeByBarber, startTimes } from '@/lib/slots';
import { today } from '@/lib/metrics';
import { ActionForm, Modal, Submit } from '@/components/ui';
import { lookups } from '@/components/client-form';
import { messageClient } from '../clientes/actions';
import { cancelAppointment, createAppointment, setStatus, updateAppointment } from './actions';

const Q = `select a.id, a.status, a.price::float8 price, a.notes, a.starts_at::date::text as date, to_char(a.starts_at, 'HH24:MI') as hour, to_char(a.ends_at, 'HH24:MI') until,
  a.barber_id, a.client_id, a.service_id, c.name client, sv.name service, b.name barber, ms.name source
  from appointments a join clients c on c.id = a.client_id join services sv on sv.id = a.service_id join barbers b on b.id = a.barber_id
  left join marketing_sources ms on ms.id = a.source_id`;

function Act({ id, status, label, cls = 'btn btn-sm' }: { id: string; status: string; label: string; cls?: string }) {
  return <ActionForm action={setStatus} className=""><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value={status} /><Submit className={cls}>{label}</Submit></ActionForm>;
}

function Appointment({ a, staff, lk }: { a: any; staff: boolean; lk: any }) {
  const open = ['agendado', 'confirmado', 'encaixado', 'em_atendimento'].includes(a.status);
  return (
    <div className="stack-sm">
      <div className="item">
        <span className="when">{a.hour}</span>
        <span className="grow"><Link href={`/clientes/${a.client_id}`}><strong>{a.client}</strong></Link><br />
          <span className="muted small">{a.service} · até {a.until} · {brl(a.price)}{a.source && ` · ${a.source}`}</span></span>
        <span className={`badge b-${a.status}`}>{STATUS[a.status]}</span>
      </div>
      {a.notes && <p className="muted small">{a.notes}</p>}
      <div className="row">
        {['agendado', 'encaixado'].includes(a.status) && <Act id={a.id} status="confirmado" label="Confirmar" />}
        {['agendado', 'confirmado', 'encaixado'].includes(a.status) && <Act id={a.id} status="em_atendimento" label="Iniciar" />}
        {open && <Act id={a.id} status="concluido" label="Concluir" cls="btn btn-sm btn-ok" />}
        {open && a.status !== 'em_atendimento' && <Act id={a.id} status="faltou" label="Faltou" />}
        {['concluido', 'faltou'].includes(a.status) && <Act id={a.id} status="agendado" label="Desfazer" />}
        {staff && open && (
          <Modal label="Editar ou reagendar" title={`${a.client}, ${a.hour}`} className="btn btn-sm">
            <ActionForm action={updateAppointment}>
              <input type="hidden" name="id" value={a.id} />
              <div className="form-2">
                <label className="field"><span>Dia</span><input type="date" name="date" defaultValue={a.date} required /></label>
                <label className="field"><span>Horário</span><input type="time" name="time" defaultValue={a.hour} required /></label>
                <label className="field"><span>Barbeiro</span><select name="barber_id" defaultValue={a.barber_id}>{lk.barbers.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
                <label className="field"><span>Serviço</span><select name="service_id" defaultValue={a.service_id}>{lk.services.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              </div>
              <label className="field"><span>Valor (R$)</span><input name="price" inputMode="decimal" defaultValue={a.price.toFixed(2).replace('.', ',')} required /></label>
              <label className="field"><span>Observações</span><input name="notes" defaultValue={a.notes ?? ''} maxLength={500} /></label>
              <label className="check"><input type="checkbox" name="force" value="1" />Encaixe: permitir fora do horário livre</label>
              <Submit>Salvar alterações</Submit>
            </ActionForm>
          </Modal>
        )}
        {staff && open && (
          <ActionForm action={messageClient} className="">
            <input type="hidden" name="client_id" value={a.client_id} /><input type="hidden" name="appointment_id" value={a.id} />
            <input type="hidden" name="kind" value={a.status === 'confirmado' ? 'lembrete' : 'confirmacao'} />
            <Submit className="btn btn-sm">{a.status === 'confirmado' ? 'Mensagem de lembrete' : 'Mensagem de confirmação'}</Submit>
          </ActionForm>
        )}
        {staff && open && a.status !== 'em_atendimento' && (
          <ActionForm action={cancelAppointment} className=""><input type="hidden" name="id" value={a.id} /><Submit className="btn btn-sm btn-danger">Cancelar horário</Submit></ActionForm>
        )}
      </div>
    </div>
  );
}

export default async function AgendaPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const view = ['semana', 'mes'].includes(sp.v) ? sp.v : 'dia';
  const staff = s.role !== 'barbeiro';
  const d = await withTenant(s, async (tx) => {
    const t = await today(tx), date = isDate(sp.d) ? sp.d : t;
    const lk = await lookups(tx);
    const barbers = lk.barbers.filter((b) => staff || b.id === s.barberId);
    const st = (await tx.one(`select slot_minutes from settings`))!;
    const base = { t, date, lk, barbers, step: st.slot_minutes as number };
    if (view === 'dia') {
      const { free, work } = await freeByBarber(tx, date, staff ? null : s.barberId);
      return { ...base, free, work, rows: await tx.q(`${Q} where a.starts_at >= $1::date and a.starts_at < ($1::date + 1) order by a.starts_at`, [date]),
        clients: staff ? await tx.q(`select id, name, phone from clients order by name limit 1000`) : [] };
    }
    const from = view === 'semana' ? addDays(date, -((weekday(date) + 6) % 7)) : addDays(monthStart(date), -weekday(monthStart(date)));
    const to = view === 'semana' ? addDays(from, 6) : addDays(monthEnd(date), 6 - weekday(monthEnd(date)));
    return { ...base, from, to, rows: await tx.q(`${Q} where a.starts_at >= $1::date and a.starts_at < ($2::date + 1) and a.status <> 'cancelado' order by a.starts_at`, [from, to]),
      free: null, work: null, clients: [] };
  });
  const { date, t } = d;
  const range = d as unknown as { from: string; to: string };
  const step = view === 'dia' ? 1 : view === 'semana' ? 7 : 0;
  const prev = step ? addDays(date, -step) : addMonths(date, -1), next = step ? addDays(date, step) : addMonths(date, 1);
  const link = (dt: string, v = view) => `/agenda?d=${dt}${v === 'dia' ? '' : `&v=${v}`}`;
  const preB = isUuid(sp.b) ? sp.b : '', preC = isUuid(sp.c) ? sp.c : '', preH = /^\d\d:\d\d$/.test(sp.h ?? '') ? sp.h : '';
  const active = d.rows.filter((a) => !['cancelado', 'faltou'].includes(a.status));

  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>{view === 'mes' ? monthName(date) : view === 'semana' ? `Semana de ${longDate(range.from)}` : longDate(date)}</h1>
          <p>{view === 'dia' ? `${active.length} ${active.length === 1 ? 'atendimento' : 'atendimentos'}${date === t ? ' hoje' : ''}` : `${d.rows.length} agendamentos no período`}</p></div>
        {staff && view === 'dia' && (
          <Modal label="Novo agendamento" title="Novo agendamento" className="btn btn-primary" open={sp.novo === '1'}>
            {d.lk.barbers.length && d.lk.services.length ? (
              <ActionForm action={createAppointment}>
                <label className="field"><span>Cliente</span>
                  <select name="client_id" defaultValue={preC}><option value="">Novo cliente (preencha abaixo)</option>{d.clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? `, ${c.phone}` : ''}</option>)}</select></label>
                <div className="form-2">
                  <label className="field"><span>Nome do novo cliente</span><input name="new_name" maxLength={80} /></label>
                  <label className="field"><span>Telefone</span><input name="new_phone" inputMode="tel" /></label>
                </div>
                <label className="field"><span>Como chegou até aqui</span><select name="source_id"><option value="">Usar a origem do cadastro</option>{d.lk.sources.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
                <div className="form-2">
                  <label className="field"><span>Serviço</span><select name="service_id" required>{d.lk.services.map((x) => <option key={x.id} value={x.id}>{x.name}, {x.duration_min} min, {brl(x.price)}</option>)}</select></label>
                  <label className="field"><span>Barbeiro</span><select name="barber_id" defaultValue={preB} required>{d.lk.barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
                  <label className="field"><span>Dia</span><input type="date" name="date" defaultValue={date} required /></label>
                  <label className="field"><span>Horário</span><input type="time" name="time" defaultValue={preH} step={300} required /></label>
                </div>
                <label className="field"><span>Observações</span><input name="notes" maxLength={500} /></label>
                <label className="check"><input type="checkbox" name="force" value="1" />Encaixe: permitir fora do horário livre</label>
                <Submit>Agendar</Submit>
                <p className="small muted">Sem horário? <Link href={`/fila?novo=1${preC ? `&c=${preC}` : ''}`}>Colocar na fila de espera</Link></p>
              </ActionForm>
            ) : <p>Antes de agendar, cadastre pelo menos um <Link href="/barbeiros">barbeiro</Link> e um <Link href="/servicos">serviço</Link>.</p>}
          </Modal>
        )}
      </div>

      <div className="row between">
        <div className="row">
          <Link className="btn btn-sm" href={link(prev)} aria-label="Anterior">‹</Link>
          <Link className="btn btn-sm" href={link(t)}>Hoje</Link>
          <Link className="btn btn-sm" href={link(next)} aria-label="Próximo">›</Link>
          <form action="/agenda" className="row"><input type="date" name="d" defaultValue={date} aria-label="Ir para o dia" />{view !== 'dia' && <input type="hidden" name="v" value={view} />}<button className="btn btn-sm">Ir</button></form>
        </div>
        <nav className="seg" aria-label="Visualização">
          {[['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']].map(([k, l]) => <Link key={k} href={link(date, k)} aria-current={view === k ? 'true' : undefined}>{l}</Link>)}
        </nav>
      </div>

      {view === 'dia' && (
        <div className={`grid ${d.barbers.length > 1 ? 'cols-2' : ''}`}>
          {d.barbers.map((b) => {
            const mine = d.rows.filter((a) => a.barber_id === b.id);
            const free = d.free!.get(b.id) ?? [], works = (d.work!.get(b.id) ?? []).length > 0;
            const chips = startTimes(free, d.step, d.step);
            return (
              <section className="card stack" key={b.id}>
                <h2>{b.name}</h2>
                <div className="list">
                  {mine.map((a) => <Appointment key={a.id} a={a} staff={staff} lk={d.lk} />)}
                  {!mine.length && <p className="empty">{works ? 'Nenhum agendamento neste dia.' : 'Não atende neste dia.'}</p>}
                </div>
                {chips.length > 0 && (
                  <div className="stack-sm">
                    <h3>Horários livres</h3>
                    <div className="chips">
                      {chips.map((m) => staff
                        ? <Link key={m} className="chip" href={`/agenda?d=${date}&novo=1&b=${b.id}&h=${hm(m)}`}>{hm(m)}</Link>
                        : <span key={m} className="chip">{hm(m)}</span>)}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
          {!d.barbers.length && <div className="card"><p className="empty">Cadastre os <Link href="/barbeiros">barbeiros</Link> para montar a agenda.</p></div>}
        </div>
      )}

      {view === 'semana' && (
        <div className="grid cols-2">
          {Array.from({ length: 7 }, (_, i) => addDays(range.from, i)).map((day) => {
            const list = d.rows.filter((a) => a.date === day);
            return (
              <section className="card" key={day}>
                <h2><Link href={link(day, 'dia')}>{longDate(day)}</Link>{day === t && <span className="badge b-agendado"> hoje</span>}</h2>
                <div className="list">
                  {list.map((a) => <div className="item" key={a.id}><span className="when">{a.hour}</span><span className="grow">{a.client}<br /><span className="muted small">{a.service} com {a.barber}</span></span><span className={`badge b-${a.status}`}>{STATUS[a.status]}</span></div>)}
                  {!list.length && <p className="empty">Sem agendamentos.</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {view === 'mes' && (
        <div className="cal">
          {DIAS_CURTOS.map((x) => <div className="head" key={x}>{x}</div>)}
          {Array.from({ length: Math.round((Date.parse(range.to) - Date.parse(range.from)) / 864e5) + 1 }, (_, i) => addDays(range.from, i)).map((day) => {
            const list = d.rows.filter((a) => a.date === day);
            const total = list.filter((a) => a.status !== 'faltou').reduce((x, a) => x + a.price, 0);
            return (
              <Link key={day} href={link(day, 'dia')} className={`${day.slice(0, 7) !== date.slice(0, 7) ? 'out' : ''}${day === t ? ' is-today' : ''}`}>
                <b>{Number(day.slice(8))}</b>
                {list.length > 0 && <small>{list.length} {list.length === 1 ? 'horário' : 'horários'}{staff && <span className="hide-sm"><br />{brl(total)}</span>}</small>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
