import Link from 'next/link';
import { requireSession, ADMIN } from '@/lib/auth';
import { withTenant } from '@/lib/db';
import { brl, dmy, isUuid, num, pct, ratio } from '@/lib/format';
import { funnel, parsePeriod, today } from '@/lib/metrics';
import { ActionForm, Modal, Submit } from '@/components/ui';
import { PeriodNav } from '@/components/period';
import { Funnel, sumFunnel } from '@/components/funnel';
import { removeMetrics, saveMetrics } from './actions';

function MetricsForm({ src, t }: { src: any; t: string }) {
  const g = src.kind === 'google';
  const F = ({ name, label }: { name: string; label: string }) => <label className="field"><span>{label}</span><input name={name} type="number" min={0} inputMode="numeric" /></label>;
  return (
    <ActionForm action={saveMetrics}>
      <input type="hidden" name="source_id" value={src.id} />
      <label className="field"><span>Dia (ou último dia do período que você está lançando)</span><input type="date" name="date" defaultValue={t} max={t} required /></label>
      <div className="form-2">
        <F name="views" label="Visualizações" />
        <F name="interactions" label={g ? 'Pesquisas' : 'Interações'} />
        <F name="clicks" label="Cliques" />
        <F name="leads" label="Leads (pediram horário ou informação)" />
        {g ? <><F name="calls" label="Ligações" /><F name="route_requests" label="Solicitações de rota" /><F name="site_visits" label="Visitas ao site" /></>
          : <F name="followers" label="Total de seguidores no dia" />}
      </div>
      <Submit>Salvar números</Submit>
      <p className="small muted">Copie os números do painel do {g ? 'Perfil da Empresa no Google' : src.name}. Agendamentos, atendimentos e faturamento o sistema calcula sozinho pela origem do cliente.</p>
    </ActionForm>
  );
}

export default async function MarketingPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const s = await requireSession(ADMIN);
  const sp = await searchParams;
  const d = await withTenant(s, async (tx) => {
    const t = await today(tx), p = parsePeriod(sp, t, '30d');
    return {
      t, p, sources: await funnel(tx, p.from, p.to),
      entries: await tx.q(`select m.id, m.metric_date::text d, s.name, m.views, m.interactions, m.clicks, m.leads, m.followers from marketing_metrics m join marketing_sources s on s.id = m.source_id
                           where m.metric_date between $1 and $2 order by m.metric_date desc, s.name limit 60`, [p.from, p.to]),
    };
  });
  const sel = isUuid(sp.o) ? d.sources.find((x) => x.id === sp.o) : undefined;
  const totalNew = d.sources.reduce((n, x) => n + x.novos, 0);
  const extra = `&de=${d.p.from}&ate=${d.p.to}`;
  const tracked = d.sources.filter((x) => ['instagram', 'google'].includes(x.kind));
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Marketing</h1><p>{d.p.label}: quanto cada canal traz de cliente e de dinheiro.</p></div></div>
      <PeriodNav period={d.p} path="/marketing" />

      <div className="grid cols-2">
        {tracked.map((x) => (
          <section className="card stack" key={x.id}>
            <div className="row between"><h2>{x.name}</h2><Modal label="Lançar números" title={`Números de ${x.name}`} className="btn btn-sm"><MetricsForm src={x} t={d.t} /></Modal></div>
            <dl className="stats">
              <div className="stat"><dt>Visualizações</dt><dd>{num(x.views)}</dd></div>
              <div className="stat"><dt>{x.kind === 'google' ? 'Pesquisas' : 'Interações'}</dt><dd>{num(x.interactions)}</dd></div>
              <div className="stat"><dt>Cliques</dt><dd>{num(x.clicks)}</dd></div>
              {x.kind === 'google'
                ? <><div className="stat"><dt>Ligações</dt><dd>{num(x.calls)}</dd></div><div className="stat"><dt>Rotas</dt><dd>{num(x.route_requests)}</dd></div><div className="stat"><dt>Visitas ao site</dt><dd>{num(x.site_visits)}</dd></div></>
                : <><div className="stat"><dt>Seguidores</dt><dd>{x.followers_last == null ? 'sem dado' : num(x.followers_last)}{x.followers_last != null && <small>{x.followers_last - x.followers_first >= 0 ? '+' : ''}{num(x.followers_last - x.followers_first)} no período</small>}</dd></div><div className="stat"><dt>Leads</dt><dd>{num(x.leads)}</dd></div></>}
              <div className="stat"><dt>Agendamentos</dt><dd>{x.agendamentos}</dd></div>
              <div className="stat"><dt>Atendimentos</dt><dd>{x.atendimentos}</dd></div>
              <div className="stat"><dt>Receita gerada</dt><dd className="money">{brl(x.receita)}</dd></div>
            </dl>
            <p className="small muted">Visualização → agendamento: {pct(ratio(x.agendamentos, x.views))} · agendamento → atendimento: {pct(ratio(x.atendimentos, x.agendamentos))} · receita por atendimento: {brl(x.atendimentos ? x.receita / x.atendimentos : 0)}</p>
          </section>
        ))}
      </div>

      <div className="grid cols-main">
        <section className="card stack"><h2>De onde vêm meus clientes?</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Canal</th><th className="right">Clientes novos</th><th className="right">Participação</th><th className="right">Atendimentos</th><th className="right">Faturamento</th></tr></thead>
            <tbody>
              {d.sources.map((x) => (
                <tr key={x.id}><td><Link href={`/marketing?p=custom${extra}&o=${x.id}`}>{x.name}</Link></td><td className="num right">{x.novos}</td><td className="num right">{pct(ratio(x.novos, totalNew))}</td><td className="num right">{x.atendimentos}</td><td className="num right">{brl(x.receita)}</td></tr>
              ))}
            </tbody>
          </table></div>
          <p className="small muted">Conta os clientes cadastrados no período, pela origem informada no cadastro ou no agendamento.</p>
        </section>
        <section className="card stack">
          <div className="row between"><h2>Funil: {sel?.name ?? 'geral'}</h2></div>
          <nav className="seg" aria-label="Canal do funil">
            <Link href={`/marketing?p=custom${extra}`} aria-current={!sel ? 'true' : undefined}>Geral</Link>
            {d.sources.filter((x) => ['instagram', 'google', 'indicacao'].includes(x.kind)).map((x) => <Link key={x.id} href={`/marketing?p=custom${extra}&o=${x.id}`} aria-current={sel?.id === x.id ? 'true' : undefined}>{x.name}</Link>)}
          </nav>
          <Funnel f={sel ? sumFunnel([sel]) : sumFunnel(d.sources)} />
        </section>
      </div>

      <section className="card"><h2>Números lançados</h2>
        <div className="list">
          {d.entries.map((e) => (
            <div className="item" key={e.id}><span className="when">{dmy(e.d)}</span><span className="grow">{e.name}<br /><span className="muted small">{num(e.views)} visualizações · {num(e.interactions)} interações · {num(e.clicks)} cliques · {num(e.leads)} leads{e.followers != null && ` · ${num(e.followers)} seguidores`}</span></span>
              <ActionForm action={removeMetrics} className=""><input type="hidden" name="id" value={e.id} /><Submit className="btn btn-sm">Excluir</Submit></ActionForm></div>
          ))}
          {!d.entries.length && <p className="empty">Nenhum número lançado neste período. Use "Lançar números" no Instagram ou no Google acima.</p>}
        </div>
      </section>
    </div>
  );
}
