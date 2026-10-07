import { requireSession, ADMIN } from '@/lib/auth';
import { withTenant } from '@/lib/db';
import { brl, hours, pct } from '@/lib/format';
import { barberStats, parsePeriod, today } from '@/lib/metrics';
import { ActionForm, Modal, Submit } from '@/components/ui';
import { HoursForm } from '@/components/hours';
import { PeriodNav } from '@/components/period';
import { clearBarberHours, saveBarber, saveHours, toggleBarber } from './actions';

function Form({ b, services }: { b?: any; services: any[] }) {
  return (
    <ActionForm action={saveBarber}>
      {b && <input type="hidden" name="id" value={b.id} />}
      <label className="field"><span>Nome</span><input name="name" defaultValue={b?.name} required maxLength={80} /></label>
      <label className="field"><span>Especialidades</span><input name="specialties" defaultValue={b?.specialties ?? ''} maxLength={200} placeholder="Degradê, barba desenhada" /></label>
      <label className="field"><span>Link da foto</span><input name="photo_url" type="url" defaultValue={b?.photo_url ?? ''} placeholder="https://" /></label>
      <div className="form-2">
        <label className="field"><span>Comissão (%)</span><input name="commission_pct" inputMode="decimal" defaultValue={b?.commission_pct ?? 0} /></label>
        <label className="field"><span>Meta mensal (R$)</span><input name="monthly_goal" inputMode="decimal" defaultValue={b?.monthly_goal ?? ''} /></label>
      </div>
      <fieldset className="field"><span>Serviços que faz</span>
        <div className="checks">
          {services.map((sv) => <label key={sv.id} className="check"><input type="checkbox" name="services[]" value={sv.id} defaultChecked={b ? b.services.includes(sv.id) : true} />{sv.name}</label>)}
          {!services.length && <small className="muted">Cadastre os serviços para marcar aqui.</small>}
        </div>
      </fieldset>
      <Submit>Salvar barbeiro</Submit>
    </ActionForm>
  );
}

export default async function BarbersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const s = await requireSession(ADMIN);
  const sp = await searchParams;
  const data = await withTenant(s, async (tx) => {
    const t = await today(tx), period = parsePeriod(sp, t);
    const barbers = await tx.q(`select b.*, coalesce((select array_agg(service_id) from barber_services where barber_id = b.id), '{}') services from barbers b order by active desc, name`);
    const hoursRows = await tx.q(`select barber_id, weekday, opens::text, closes::text, break_start::text, break_end::text from work_hours where barber_id is not null`);
    const stats: Record<string, any> = {};
    for (const b of barbers) if (b.active) stats[b.id] = await barberStats(tx, b.id, period.from, period.to, t);
    return { period, barbers, stats, hoursRows, services: await tx.q(`select id, name from services where active order by name`) };
  });
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Barbeiros</h1><p>{data.period.label}</p></div>
        <Modal label="Novo barbeiro" title="Novo barbeiro" className="btn btn-primary"><Form services={data.services} /></Modal>
      </div>
      <PeriodNav period={data.period} path="/barbeiros" />
      {!data.barbers.length && <div className="card"><p className="empty">Nenhum barbeiro ainda. Cadastre quem atende para liberar a agenda.</p></div>}
      <div className="grid cols-2">
        {data.barbers.map((b) => {
          const st = data.stats[b.id];
          const own = data.hoursRows.filter((h) => h.barber_id === b.id);
          return (
            <section className="card stack" key={b.id}>
              <div className="row between">
                <div className="row">
                  {b.photo_url && <img src={b.photo_url} alt="" width={44} height={44} className="avatar" referrerPolicy="no-referrer" />}
                  <div><h2>{b.name}</h2><p className="muted small">{b.specialties || 'Sem especialidades informadas'} · comissão {b.commission_pct}%{!b.active && ' · inativo'}</p></div>
                </div>
                <div className="row">
                  <Modal label="Editar" title={b.name} className="btn btn-sm"><Form b={b} services={data.services} /></Modal>
                  <Modal label="Horários" title={`Horários de ${b.name}`} className="btn btn-sm">
                    <div className="stack">
                      <p className="muted small">{own.length ? 'Este barbeiro tem horário próprio. Dias desmarcados são folga.' : 'Hoje segue o horário da barbearia. Marque os dias para criar um horário próprio.'}</p>
                      <HoursForm action={saveHours} rows={own as any} barberId={b.id} />
                      {own.length > 0 && <ActionForm action={clearBarberHours}><input type="hidden" name="barber_id" value={b.id} /><Submit className="btn btn-sm">Voltar ao horário da barbearia</Submit></ActionForm>}
                    </div>
                  </Modal>
                  <ActionForm action={toggleBarber} className=""><input type="hidden" name="id" value={b.id} /><Submit className="btn btn-sm">{b.active ? 'Desativar' : 'Reativar'}</Submit></ActionForm>
                </div>
              </div>
              {st && (
                <>
                  <dl className="stats">
                    <div className="stat"><dt>Faturamento</dt><dd className="money">{brl(st.realizado)}</dd></div>
                    <div className="stat"><dt>Atendimentos</dt><dd>{st.concluidos}</dd></div>
                    <div className="stat"><dt>Ticket médio</dt><dd>{brl(st.ticket)}</dd></div>
                    <div className="stat"><dt>Receita por hora</dt><dd>{brl(st.porHora)}</dd></div>
                    <div className="stat"><dt>Horas de expediente</dt><dd>{hours(st.occ.avail)}</dd></div>
                    <div className="stat"><dt>Ocupação</dt><dd>{pct(st.occ.pct)}</dd></div>
                    <div className="stat"><dt>Clientes novos</dt><dd>{st.novos}</dd></div>
                    <div className="stat"><dt>Recorrentes</dt><dd>{st.recorrentes}</dd></div>
                  </dl>
                  {b.monthly_goal > 0 && data.period.key === 'mes' && (
                    <div className="bar-row"><span>Meta do mês: {brl(b.monthly_goal)}</span><strong className="num">{pct((st.realizado / b.monthly_goal) * 100)}</strong><progress className="brass" value={Math.min(st.realizado, b.monthly_goal)} max={b.monthly_goal} aria-label="Meta do mês" /></div>
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
