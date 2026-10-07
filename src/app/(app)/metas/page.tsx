import Link from 'next/link';
import { requireSession, ADMIN } from '@/lib/auth';
import { withTenant } from '@/lib/db';
import { addMonths, monthEnd, monthName, pct } from '@/lib/format';
import { snapshot, today } from '@/lib/metrics';
import { GOALS } from '@/lib/goals';
import { ActionForm, Modal, Submit } from '@/components/ui';
import { removeGoal, saveGoal } from './actions';

export default async function GoalsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const s = await requireSession(ADMIN);
  const sp = await searchParams;
  const d = await withTenant(s, async (tx) => {
    const t = await today(tx);
    const month = /^\d{4}-\d{2}$/.test(sp.m ?? '') ? `${sp.m}-01` : `${t.slice(0, 7)}-01`;
    return {
      t, month, goals: await tx.q(`select id, metric, target::float8 target from goals where month = $1::date order by metric`, [month]),
      snap: await snapshot(tx, { key: 'custom', from: month, to: monthEnd(month), label: '' }, t),
    };
  });
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Metas</h1><p>{monthName(d.month)}</p></div>
        <Modal label="Nova meta" title="Nova meta" className="btn btn-primary">
          <ActionForm action={saveGoal}>
            <label className="field"><span>O que você quer alcançar</span><select name="metric">{Object.entries(GOALS).map(([k, g]) => <option key={k} value={k}>{g.label}</option>)}</select></label>
            <div className="form-2">
              <label className="field"><span>Meta</span><input name="target" inputMode="decimal" required /></label>
              <label className="field"><span>Mês</span><input type="month" name="month" defaultValue={d.month.slice(0, 7)} required /></label>
            </div>
            <Submit>Salvar meta</Submit>
          </ActionForm>
        </Modal>
      </div>
      <div className="row">
        <Link className="btn btn-sm" href={`/metas?m=${addMonths(d.month, -1).slice(0, 7)}`}>‹ Mês anterior</Link>
        <Link className="btn btn-sm" href="/metas">Mês atual</Link>
        <Link className="btn btn-sm" href={`/metas?m=${addMonths(d.month, 1).slice(0, 7)}`}>Próximo mês ›</Link>
      </div>
      <div className="grid cols-2">
        {d.goals.map((g) => {
          const def = GOALS[g.metric], cur = def.value(d.snap), p = (cur / g.target) * 100;
          return (
            <section className="card stack-sm" key={g.id}>
              <div className="row between"><h2>{def.label}</h2><ActionForm action={removeGoal} className=""><input type="hidden" name="id" value={g.id} /><Submit className="btn btn-sm">Excluir</Submit></ActionForm></div>
              <dl className="stats">
                <div className="stat"><dt>Meta</dt><dd>{def.fmt(g.target)}</dd></div>
                <div className="stat"><dt>Atual</dt><dd>{def.fmt(cur)}</dd></div>
                <div className="stat"><dt>Progresso</dt><dd className={p >= 100 ? 'up' : undefined}>{pct(p)}</dd></div>
              </dl>
              <progress className="pole-bar" value={Math.min(cur, g.target)} max={g.target} aria-label={`Progresso: ${def.label}`} />
            </section>
          );
        })}
      </div>
      {!d.goals.length && <div className="card"><p className="empty">Nenhuma meta para {monthName(d.month)}. Crie uma, por exemplo faturar R$ 20.000 no mês, e acompanhe o progresso aqui e no painel.</p></div>}
    </div>
  );
}
