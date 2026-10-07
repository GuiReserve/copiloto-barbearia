import { requireSession, ADMIN } from '@/lib/auth';
import { terms } from '@/lib/terms';
import { withTenant } from '@/lib/db';
import { brl, CATEGORIAS, dmy, hours, pct } from '@/lib/format';
import { parsePeriod, revenueByBarber, revenueByService, snapshot, today } from '@/lib/metrics';
import { ActionForm, Modal, Submit } from '@/components/ui';
import { Bars, PeriodNav } from '@/components/period';
import { addExpense, addFixedCost, addRevenue, removeEntry } from './actions';

const cats = Object.entries(CATEGORIAS).filter(([k]) => k !== 'atendimento');
function Remove({ id, kind, label = 'Excluir' }: { id: string; kind: string; label?: string }) {
  return <ActionForm action={removeEntry} className=""><input type="hidden" name="id" value={id} /><input type="hidden" name="kind" value={kind} /><Submit className="btn btn-sm">{label}</Submit></ActionForm>;
}

export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const s = await requireSession(ADMIN);
  const t = terms(s.kind);
  const sp = await searchParams;
  const d = await withTenant(s, async (tx) => {
    const t = await today(tx), p = parsePeriod(sp, t);
    return {
      t, p, snap: await snapshot(tx, p, t),
      byBarber: await revenueByBarber(tx, p.from, p.to), byService: await revenueByService(tx, p.from, p.to),
      expenses: await tx.q(`select id, category, description, amount::float8 amount, spent_on::text d from expenses where spent_on between $1 and $2 order by spent_on desc, created_at desc limit 200`, [p.from, p.to]),
      byCat: await tx.q(`select category, sum(amount)::float8 total from expenses where spent_on between $1 and $2 group by 1 order by 2 desc`, [p.from, p.to]),
      fixed: await tx.q(`select id, category, name, amount::float8 amount, starts_on::text, ends_on::text from fixed_costs order by ends_on nulls first, amount desc`),
      others: await tx.q(`select id, category, description, amount::float8 amount, received_on::text d from revenues where appointment_id is null and received_on between $1 and $2 order by received_on desc limit 100`, [p.from, p.to]),
      barbers: await tx.q(`select id, name from barbers where active order by name`),
    };
  });
  const { fin, occ, porHora } = d.snap;
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Financeiro</h1><p>{d.p.label}</p></div>
        <div className="row">
          <Modal label="Lançar despesa" title="Nova despesa" className="btn btn-primary">
            <ActionForm action={addExpense}>
              <div className="form-2">
                <label className="field"><span>Categoria</span><select name="category">{cats.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label className="field"><span>Valor (R$)</span><input name="amount" inputMode="decimal" required /></label>
              </div>
              <label className="field"><span>Data</span><input type="date" name="date" defaultValue={d.t} required /></label>
              <label className="field"><span>Descrição</span><input name="description" maxLength={120} /></label>
              <Submit>Salvar despesa</Submit>
            </ActionForm>
          </Modal>
          <Modal label="Custo fixo" title="Novo custo fixo mensal">
            <ActionForm action={addFixedCost}>
              <label className="field"><span>Nome</span><input name="name" required maxLength={80} placeholder="Aluguel" /></label>
              <div className="form-2">
                <label className="field"><span>Categoria</span><select name="category">{cats.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label className="field"><span>Valor por mês (R$)</span><input name="amount" inputMode="decimal" required /></label>
              </div>
              <label className="field"><span>Vale a partir de</span><input type="date" name="starts_on" defaultValue={d.t.slice(0, 8) + '01'} required /><small>Entra sozinho na conta de todo mês, rateado por dia.</small></label>
              <Submit>Salvar custo fixo</Submit>
            </ActionForm>
          </Modal>
          <Modal label="Outra receita" title="Receita de produtos ou outras">
            <ActionForm action={addRevenue}>
              <div className="form-2">
                <label className="field"><span>Tipo</span><select name="category"><option value="produtos">Produtos</option><option value="outros">Outros</option></select></label>
                <label className="field"><span>Valor (R$)</span><input name="amount" inputMode="decimal" required /></label>
                <label className="field"><span>Data</span><input type="date" name="date" defaultValue={d.t} required /></label>
                <label className="field"><span>Quem vendeu</span><select name="barber_id"><option value="">{t.Negocio}</option>{d.barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              </div>
              <label className="field"><span>Descrição</span><input name="description" maxLength={120} /></label>
              <Submit>Salvar receita</Submit>
              <p className="small muted">A receita de atendimentos entra sozinha quando o horário é concluído na agenda.</p>
            </ActionForm>
          </Modal>
        </div>
      </div>
      <PeriodNav period={d.p} path="/financeiro" />

      <dl className="stats">
        <div className="stat lead"><dt>Receita</dt><dd className="money">{brl(fin.revenue)}</dd></div>
        <div className="stat"><dt>Custos</dt><dd>{brl(fin.costs)}<small>{brl(fin.fixed)} fixos + {brl(fin.variable)} variáveis</small></dd></div>
        <div className="stat"><dt>Lucro estimado</dt><dd className={fin.profit >= 0 ? 'up' : 'down'}>{brl(fin.profit)}<small>margem {pct(fin.margin)}</small></dd></div>
        <div className="stat"><dt>Ticket médio</dt><dd>{brl(fin.ticket)}</dd></div>
        <div className="stat"><dt>Receita por hora</dt><dd>{brl(porHora)}<small>{hours(occ.avail)} de expediente</small></dd></div>
      </dl>
      <p className="small muted">Lucro estimado = receita − despesas lançadas − custos fixos rateados pelos dias do período − comissões calculadas ({brl(fin.commissions)}).</p>

      <div className="grid cols-2">
        <section className="card"><h2>Receita por {t.pro}</h2><Bars brass format={brl} rows={d.byBarber.map((b) => ({ label: b.name, value: b.total, hint: `${b.atendimentos} atend.` }))} /></section>
        <section className="card"><h2>Receita por serviço</h2><Bars brass format={brl} rows={d.byService.map((x) => ({ label: x.name, value: x.total, hint: `${x.atendimentos} atend. · ${brl(x.por_hora)}/h` }))} /></section>
        <section className="card"><h2>Receita por tipo</h2><Bars brass format={brl} rows={[['Atendimentos', fin.byCategory.atendimento], ['Produtos', fin.byCategory.produtos], ['Outros', fin.byCategory.outros]].filter(([, x]) => (x as number) > 0).map(([label, value]) => ({ label: label as string, value: value as number }))} /></section>
        <section className="card"><h2>Despesas por categoria</h2><Bars format={brl} rows={d.byCat.map((c) => ({ label: CATEGORIAS[c.category], value: c.total }))} /></section>
      </div>

      <section className="card"><h2>Custos fixos mensais</h2>
        <div className="list">
          {d.fixed.map((f) => (
            <div className="item" key={f.id}>
              <span className="grow"><strong>{f.name}</strong> <span className="badge">{CATEGORIAS[f.category]}</span><br /><span className="muted small">desde {dmy(f.starts_on)}/{f.starts_on.slice(0, 4)}{f.ends_on && `, encerrado em ${dmy(f.ends_on)}/${f.ends_on.slice(0, 4)}`}</span></span>
              <span className="num">{brl(f.amount)}/mês</span>
              {!f.ends_on && <Remove id={f.id} kind="fixed_end" label="Encerrar" />}
              <Remove id={f.id} kind="fixed" />
            </div>
          ))}
          {!d.fixed.length && <p className="empty">Nenhum custo fixo. Cadastre aluguel, internet e salários uma vez; o sistema considera todo mês.</p>}
        </div>
      </section>

      <div className="grid cols-2">
        <section className="card"><h2>Despesas do período</h2>
          <div className="list">
            {d.expenses.map((e) => <div className="item" key={e.id}><span className="when">{dmy(e.d)}</span><span className="grow">{CATEGORIAS[e.category]}{e.description && <span className="muted"> · {e.description}</span>}</span><span className="num">{brl(e.amount)}</span><Remove id={e.id} kind="expense" /></div>)}
            {!d.expenses.length && <p className="empty">Nenhuma despesa lançada neste período.</p>}
          </div>
        </section>
        <section className="card"><h2>Produtos e outras receitas</h2>
          <div className="list">
            {d.others.map((e) => <div className="item" key={e.id}><span className="when">{dmy(e.d)}</span><span className="grow">{CATEGORIAS[e.category]}{e.description && <span className="muted"> · {e.description}</span>}</span><span className="num">{brl(e.amount)}</span><Remove id={e.id} kind="revenue" /></div>)}
            {!d.others.length && <p className="empty">Nenhuma receita avulsa neste período.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
