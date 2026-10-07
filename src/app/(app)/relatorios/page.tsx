import { requireSession, ADMIN } from '@/lib/auth';
import { terms } from '@/lib/terms';
import { withTenant } from '@/lib/db';
import { brl, dmy, hours, pct } from '@/lib/format';
import { parsePeriod, revenueByBarber, revenueByDay, revenueByService, snapshot, today } from '@/lib/metrics';
import { Columns, PeriodNav } from '@/components/period';

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const s = await requireSession(ADMIN);
  const t = terms(s.kind);
  const sp = await searchParams;
  const d = await withTenant(s, async (tx) => {
    const t = await today(tx), p = parsePeriod(sp, t);
    return { p, snap: await snapshot(tx, p, t), days: await revenueByDay(tx, p.from, p.to), byBarber: await revenueByBarber(tx, p.from, p.to), byService: await revenueByService(tx, p.from, p.to) };
  });
  const { fin, occ, agenda } = d.snap;
  const withRevenue = d.days.filter((x) => x.total > 0);
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Relatório de faturamento</h1><p>{d.p.label}</p></div>
        <a className="btn" href={`/relatorios/exportar?p=custom&de=${d.p.from}&ate=${d.p.to}`}>Baixar planilha (CSV)</a>
      </div>
      <PeriodNav period={d.p} path="/relatorios" />
      <dl className="stats">
        <div className="stat lead"><dt>Faturamento</dt><dd className="money">{brl(fin.revenue)}</dd></div>
        <div className="stat"><dt>Atendimentos</dt><dd>{agenda.concluidos}</dd></div>
        <div className="stat"><dt>Ticket médio</dt><dd>{brl(fin.ticket)}</dd></div>
        <div className="stat"><dt>Lucro estimado</dt><dd>{brl(fin.profit)}</dd></div>
        <div className="stat"><dt>Melhor dia</dt><dd>{withRevenue.length ? dmy(withRevenue.reduce((a, b) => (b.total > a.total ? b : a)).d) : 'sem dado'}</dd></div>
      </dl>
      <section className="card"><h2>Faturamento por dia</h2>
        <Columns brass data={d.days.map((x) => x.total)} labels={[dmy(d.p.from), dmy(d.p.to)]} title="Faturamento por dia" />
      </section>
      <section className="card"><h2>Tempo x dinheiro</h2>
        <dl className="stats">
          <div className="stat"><dt>Horas de expediente</dt><dd>{hours(occ.avail)}</dd></div>
          <div className="stat"><dt>Horas ocupadas</dt><dd>{hours(occ.busy)}</dd></div>
          <div className="stat"><dt>Horas ociosas</dt><dd>{hours(occ.idle)}</dd></div>
          <div className="stat"><dt>Ocupação</dt><dd>{pct(occ.pct)}</dd></div>
          <div className="stat"><dt>Valor da sua hora</dt><dd className="money">{brl(d.snap.porHora)}</dd></div>
        </dl>
        <p className="small muted">Considera o expediente até hoje. Valor da hora = faturamento ÷ horas de expediente.</p>
      </section>
      <div className="grid cols-2">
        <section className="card"><h2>Por {t.pro}</h2>
          <div className="table-wrap"><table><thead><tr><th>{t.Pro}</th><th className="right">Atendimentos</th><th className="right">Faturamento</th><th className="right">Ticket</th></tr></thead>
            <tbody>{d.byBarber.map((b) => <tr key={b.id}><td>{b.name}</td><td className="num right">{b.atendimentos}</td><td className="num right">{brl(b.total)}</td><td className="num right">{brl(b.atendimentos ? b.total / b.atendimentos : 0)}</td></tr>)}</tbody></table></div>
        </section>
        <section className="card"><h2>Por serviço</h2>
          {d.byService.length ? <div className="table-wrap"><table><thead><tr><th>Serviço</th><th className="right">Atendimentos</th><th className="right">Faturamento</th><th className="right">Por hora</th></tr></thead>
            <tbody>{d.byService.map((x) => <tr key={x.name}><td>{x.name}</td><td className="num right">{x.atendimentos}</td><td className="num right">{brl(x.total)}</td><td className="num right">{brl(x.por_hora)}</td></tr>)}</tbody></table></div>
            : <p className="empty">Nenhum atendimento concluído neste período.</p>}
        </section>
      </div>
      <section className="card"><h2>Dia a dia</h2>
        {withRevenue.length ? <div className="table-wrap"><table><thead><tr><th>Dia</th><th className="right">Faturamento</th><th className="right">Clientes novos</th></tr></thead>
          <tbody>{withRevenue.map((x) => <tr key={x.d}><td className="num">{dmy(x.d)}</td><td className="num right">{brl(x.total)}</td><td className="num right">{x.novos}</td></tr>)}</tbody></table></div>
          : <p className="empty">Sem faturamento neste período. Ele aparece aqui quando os atendimentos são concluídos na agenda.</p>}
      </section>
    </div>
  );
}
