'use server';
import { z } from 'zod';
import { ADMIN } from '@/lib/auth';
import { audit, run, v, type State } from '@/lib/action';

const n = (label: string) => v.int(label, 0, 100_000_000).default(0);
const schema = z.object({
  source_id: v.id, date: v.date, views: n('as visualizações'), interactions: n('as interações'), clicks: n('os cliques'), leads: n('os leads'),
  followers: v.int('os seguidores', 0, 1_000_000_000).optional(), calls: n('as ligações'), route_requests: n('as rotas'), site_visits: n('as visitas ao site'),
});

/** Lançamento manual das métricas (um registro por origem e dia). Lançar de novo no mesmo dia substitui. */
export async function saveMetrics(_: State, fd: FormData) {
  return run(ADMIN, schema, fd, async (d, tx, s) => {
    await tx.q(
      `insert into marketing_metrics (barbershop_id, source_id, metric_date, views, interactions, clicks, leads, followers, calls, route_requests, site_visits)
       values (app_shop(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (barbershop_id, source_id, metric_date) do update set views=excluded.views, interactions=excluded.interactions, clicks=excluded.clicks,
         leads=excluded.leads, followers=excluded.followers, calls=excluded.calls, route_requests=excluded.route_requests, site_visits=excluded.site_visits`,
      [d.source_id, d.date, d.views, d.interactions, d.clicks, d.leads, d.followers ?? null, d.calls, d.route_requests, d.site_visits]);
    await audit(tx, s, 'marketing.metricas_lancadas', 'source', d.source_id, { dia: d.date });
  });
}
export async function removeMetrics(_: State, fd: FormData) {
  return run(ADMIN, z.object({ id: v.id }), fd, async (d, tx) => { await tx.q(`delete from marketing_metrics where id = $1`, [d.id]); });
}
