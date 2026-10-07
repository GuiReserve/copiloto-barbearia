import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { terms } from '@/lib/terms';
import { withTenant, type Tx } from '@/lib/db';
import { brl, dmy, hm, hours, pct, STATUS } from '@/lib/format';
import { agendaStats, barberStats, insights, parsePeriod, revenueByBarber, revenueByDay, revenueByService, snapshot, today } from '@/lib/metrics';
import { freeByBarber, occupancy, startTimes } from '@/lib/slots';
import { ActionForm, Submit } from '@/components/ui';
import { Bars, Columns, PeriodNav } from '@/components/period';
import { readNotifications } from '../fila/actions';

async function todayData(tx: Tx, t: string, barberId: string | null, staff: boolean) {
  const rows = await tx.q(
    `select a.id, a.status, to_char(a.starts_at, 'HH24:MI') as hour, a.ends_at > now() ahead, c.name client, sv.name service, b.name barber, a.price::float8 price
     from appointments a join clients c on c.id = a.client_id join services sv on sv.id = a.service_id join barbers b on b.id = a.barber_id
     where a.starts_at >= current_date and a.starts_at < current_date + 1 and a.status <> 'cancelado' order by a.starts_at`);
  const { free } = await freeByBarber(tx, t, barberId);
  const step = (await tx.one(`select slot_minutes from settings`))!.slot_minutes as number;
  const names = new Map((await tx.q(`select id, name from barbers`)).map((b) => [b.id, b.name]));
  const slots = [...free].flatMap(([b, l]) => startTimes(l, step, step).map((m) => ({ b, m, name: names.get(b) as string }))).sort((x, y) => x.m - y.m);
  const queue = staff ? await tx.q(`select w.id, c.name client, sv.name service, w.window_start::text de, w.window_end::text ate, w.desired_date::text as date
                                    from waiting_list w join clients c on c.id = w.client_id join services sv on sv.id = w.service_id
                                    where w.status = 'ativo' and w.desired_date >= current_date order by w.desired_date, w.priority desc, w.created_at limit 6`) : [];
  const notes = staff ? await tx.q(`select id, title, body, link, to_char(created_at, 'DD/MM HH24:MI') quando from notifications where read_at is null order by created_at desc limit 5`) : [];
  return { rows, slots, queue, notes, next: rows.find((r) => r.ahead && ['agendado', 'confirmado', 'encaixado', 'em_atendimento'].includes(r.status)) };
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const admin = s.role === 'admin', staff = s.role !== 'barbeiro';
  const t = terms(s.kind);
  const d = await withTenant(s, async (tx) => {
    const t = await today(tx), p = parsePeriod(sp, t);
    const base = { t, p, now: await todayData(tx, t, staff ? null : s.barberId, staff), todayStats: await agendaStats(tx, t, t) };
    if (admin) {
      const snap = await snapshot(tx, p, t);
      return { ...base, snap, insights: await insights(tx, p, snap, t), days: await revenueByDay(tx, p.from, p.to),
        byBarber: await revenueByBarber(tx, p.from, p.to), byService: await revenueByService(tx, p.from, p.to),
        todayRevenue: (await tx.one(`select coalesce(sum(amount), 0)::float8 v from revenues where received_on = current_date`))!.v as number };
    }
    return { ...base, mine: s.barberId ? await barberStats(tx, s.barberId, p.from, p.to, t) : null, period: await agendaStats(tx, p.from, p.to),
      occ: staff ? await occupancy(tx, p.from, p.to < t ? p.to : t) : null };
  });
  const { now, p } = d;
  const snap = 'snap' in d ? d.snap : null;

  return (
    <div className="stack">
      <div className="page-head"><div><h1>{admin ? t.como : `Olá, ${s.name.split(' ')[0]}`}</h1><p>{s.shopName}</p></div>
        {staff && <Link className="btn btn-primary" href="/agenda?novo=1">Novo agendamento</Link>}</div>

      {now.notes.length > 0 && (
        <div className="notice ok stack-sm">
          {now.notes.map((n) => <p key={n.id}><strong>{n.title}.</strong> {n.body} {n.link && <Link href={n.link}>Abrir</Link>} <span className="muted small">{n.quando}</span></p>)}
          <ActionForm action={readNotifications} className=""><Submit className="btn btn-sm">Marcar avisos como lidos</Submit></ActionForm>
        </div>
      )}

      {/* ── hoje, sempre no topo: é o que se olha no celular ── */}
      {now.next ? (
        <section className="next" aria-label="Próximo atendimento">
          <span className="hour">{now.next.hour}</span>
          <span><span className="muted small">Próximo atendimento</span><br /><strong>{now.next.client}</strong><br /><span className="muted">{now.next.service} com {now.next.barber}</span></span>
          <Link className="btn" href="/agenda">Abrir agenda</Link>
        </section>
      ) : <p className="notice">Nenhum atendimento pela frente hoje.{staff && now.slots.length > 0 && ' Há horários livres para encaixar alguém.'}</p>}

      <dl className="stats">
        <div className="stat"><dt>Agenda de hoje</dt><dd>{d.todayStats.total - d.todayStats.cancelados}<small>{d.todayStats.concluidos} concluídos</small></dd></div>
        <div className="stat"><dt>Horários livres hoje</dt><dd>{now.slots.length}</dd></div>
        {staff && <div className="stat"><dt>Fila de espera</dt><dd>{now.queue.length >= 6 ? '6+' : now.queue.length}</dd></div>}
        {'todayRevenue' in d && <div className="stat"><dt>Faturamento de hoje</dt><dd className="money">{brl(d.todayRevenue)}</dd></div>}
        {!admin && <div className="stat"><dt>{staff ? 'Faltas hoje' : 'Feito hoje'}</dt><dd>{staff ? d.todayStats.faltas : brl(d.todayStats.realizado)}</dd></div>}
      </dl>

      <div className="grid cols-main">
        <section className="card"><div className="row between"><h2>Agenda de hoje</h2><Link href="/agenda">Ver tudo</Link></div>
          <div className="list">
            {now.rows.slice(0, 8).map((a) => <div className="item" key={a.id}><span className="when">{a.hour}</span><span className="grow">{a.client}<br /><span className="muted small">{a.service} com {a.barber}</span></span><span className={`badge b-${a.status}`}>{STATUS[a.status]}</span></div>)}
            {!now.rows.length && <p className="empty">Nada agendado para hoje.</p>}
            {now.rows.length > 8 && <p className="muted small">e mais {now.rows.length - 8}</p>}
          </div>
        </section>
        <div className="stack">
          <section className="card"><h2>Horários livres hoje</h2>
            {now.slots.length ? <div className="chips">{now.slots.slice(0, 18).map((x) => staff
              ? <Link key={x.b + x.m} className="chip" href={`/agenda?novo=1&b=${x.b}&h=${hm(x.m)}`} title={x.name}>{hm(x.m)} {x.name.split(' ')[0]}</Link>
              : <span key={x.b + x.m} className="chip">{hm(x.m)}</span>)}</div> : <p className="empty">Agenda cheia ou expediente encerrado.</p>}
          </section>
          {staff && (
            <section className="card"><div className="row between"><h2>Fila de espera</h2><Link href="/fila">Abrir fila</Link></div>
              <div className="list">
                {now.queue.map((w) => <div className="item" key={w.id}><span className="when">{w.date === d.t ? 'Hoje' : dmy(w.date)}</span><span className="grow">{w.client}<br /><span className="muted small">{w.service} · {w.de.slice(0, 5)} às {w.ate.slice(0, 5)}</span></span></div>)}
                {!now.queue.length && <p className="empty">Ninguém esperando horário.</p>}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* ── período ── */}
      <div className="row between"><h2>{p.label}</h2><PeriodNav period={p} path="/dashboard" /></div>

      {snap && 'days' in d && (
        <>
          <dl className="stats">
            <div className="stat lead"><dt>Faturamento</dt><dd className="money">{brl(snap.fin.revenue)}{snap.agenda.previsto > 0 && <small>previsto {brl(snap.previsto)} com o que já está agendado</small>}</dd></div>
            <div className="stat"><dt>Novos clientes</dt><dd>{snap.clients.novos}</dd></div>
            <div className="stat"><dt>Atendimentos</dt><dd>{snap.agenda.concluidos}</dd></div>
            <div className="stat"><dt>Ocupação</dt><dd>{pct(snap.occ.pct)}</dd></div>
            <div className="stat"><dt>Ticket médio</dt><dd>{brl(snap.fin.ticket)}</dd></div>
            <div className="stat"><dt>Receita por hora</dt><dd>{brl(snap.porHora)}</dd></div>
          </dl>

          <section className="card stack-sm"><h2>Insights</h2>
            {d.insights.length ? <div className="list">{d.insights.map((i, k) => (
              <p key={k} className={i.tone}>{i.text}{i.projection && <span className="badge"> projeção</span>} {i.href && <Link href={i.href}>Ver</Link>}</p>
            ))}</div> : <p className="empty">Os insights aparecem conforme a agenda e o financeiro ganham dados.</p>}
          </section>

          <div className="grid cols-2">
            <section className="card"><h2>Faturamento por dia</h2><Columns brass data={d.days.map((x) => x.total)} labels={[dmy(p.from), dmy(p.to)]} title="Faturamento por dia" /></section>
            <section className="card"><h2>Novos clientes por dia</h2><Columns data={d.days.map((x) => x.novos)} labels={[dmy(p.from), dmy(p.to)]} title="Novos clientes por dia" /></section>
          </div>

          <div className="grid cols-3">
            <section className="card"><h2>Agenda</h2>
              <dl className="stats">
                <div className="stat"><dt>Agendamentos</dt><dd>{snap.agenda.total}</dd></div>
                <div className="stat"><dt>Concluídos</dt><dd>{snap.agenda.concluidos}</dd></div>
                <div className="stat"><dt>Cancelamentos</dt><dd>{snap.agenda.cancelados}</dd></div>
                <div className="stat"><dt>Faltas</dt><dd>{snap.agenda.faltas}</dd></div>
              </dl>
            </section>
            <section className="card"><h2>Financeiro</h2>
              <dl className="stats">
                <div className="stat"><dt>Lucro estimado</dt><dd className={snap.fin.profit >= 0 ? 'up' : 'down'}>{brl(snap.fin.profit)}</dd></div>
                <div className="stat"><dt>Gastos</dt><dd>{brl(snap.fin.costs)}</dd></div>
                <div className="stat"><dt>Custos fixos</dt><dd>{brl(snap.fin.fixed)}</dd></div>
                <div className="stat"><dt>Custos variáveis</dt><dd>{brl(snap.fin.variable)}</dd></div>
              </dl>
            </section>
            <section className="card"><h2>Clientes</h2>
              <dl className="stats">
                <div className="stat"><dt>Recorrentes</dt><dd>{snap.clients.recorrentes}</dd></div>
                <div className="stat"><dt>Taxa de retorno</dt><dd>{pct(snap.clients.retorno)}</dd></div>
                <div className="stat"><dt>Inativos</dt><dd>{snap.clients.inativos}</dd></div>
                <div className="stat"><dt>Perdidos</dt><dd>{snap.clients.perdidos}</dd></div>
              </dl>
            </section>
          </div>

          <section className="card stack"><h2>Valor da sua hora</h2>
            <p>Você faturou <strong className="money">{brl(snap.porHora)}</strong> por hora de expediente neste período.</p>
            <div className="bar-row"><span>Ocupação da agenda: {hours(snap.occ.busy)} ocupadas de {hours(snap.occ.avail)}, {hours(snap.occ.idle)} ociosas</span><strong className="num">{pct(snap.occ.pct)}</strong>
              <progress className="pole-bar" value={snap.occ.busy} max={Math.max(1, snap.occ.avail)} aria-label="Ocupação da agenda" /></div>
          </section>

          <div className="grid cols-2">
            <section className="card"><h2>Faturamento por {t.pro}</h2><Bars brass format={brl} rows={d.byBarber.map((b) => ({ label: b.name, value: b.total, hint: `${b.atendimentos} atend.` }))} /></section>
            <section className="card"><h2>Faturamento por serviço</h2><Bars brass format={brl} rows={d.byService.map((x) => ({ label: x.name, value: x.total, hint: `${x.atendimentos} atend.` }))} /></section>
          </div>

        </>
      )}

      {'mine' in d && d.mine && (
        <dl className="stats">
          <div className="stat lead"><dt>Seu faturamento</dt><dd className="money">{brl(d.mine.realizado)}</dd></div>
          <div className="stat"><dt>Atendimentos</dt><dd>{d.mine.concluidos}</dd></div>
          <div className="stat"><dt>Ticket médio</dt><dd>{brl(d.mine.ticket)}</dd></div>
          <div className="stat"><dt>Receita por hora</dt><dd>{brl(d.mine.porHora)}</dd></div>
          <div className="stat"><dt>Ocupação</dt><dd>{pct(d.mine.occ.pct)}</dd></div>
          <div className="stat"><dt>Clientes novos</dt><dd>{d.mine.novos}</dd></div>
          <div className="stat"><dt>Recorrentes</dt><dd>{d.mine.recorrentes}</dd></div>
        </dl>
      )}
      {'period' in d && s.role === 'recepcao' && (
        <dl className="stats">
          <div className="stat"><dt>Agendamentos</dt><dd>{d.period.total}</dd></div>
          <div className="stat"><dt>Concluídos</dt><dd>{d.period.concluidos}</dd></div>
          <div className="stat"><dt>Cancelamentos</dt><dd>{d.period.cancelados}</dd></div>
          <div className="stat"><dt>Faltas</dt><dd>{d.period.faltas}</dd></div>
          {d.occ && <div className="stat"><dt>Ocupação</dt><dd>{pct(d.occ.pct)}</dd></div>}
        </dl>
      )}
    </div>
  );
}
