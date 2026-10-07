import { requireSession, ADMIN } from '@/lib/auth';
import { withTenant } from '@/lib/db';
import { brl } from '@/lib/format';
import { ActionForm, Modal, Submit } from '@/components/ui';
import { saveService, toggleService } from './actions';

function Form({ sv, barbers }: { sv?: any; barbers: any[] }) {
  return (
    <ActionForm action={saveService}>
      {sv && <input type="hidden" name="id" value={sv.id} />}
      <label className="field"><span>Nome</span><input name="name" defaultValue={sv?.name} required maxLength={80} placeholder="Corte + barba" /></label>
      <div className="form-2">
        <label className="field"><span>Preço (R$)</span><input name="price" inputMode="decimal" defaultValue={sv?.price?.toFixed(2).replace('.', ',')} required /></label>
        <label className="field"><span>Duração (minutos)</span><input name="duration_min" type="number" min={5} max={480} step={5} defaultValue={sv?.duration_min ?? 30} required /></label>
      </div>
      <label className="field"><span>Comissão deste serviço (%)</span><input name="commission_pct" inputMode="decimal" defaultValue={sv?.commission_pct ?? ''} /><small>Em branco, vale a comissão de cada barbeiro.</small></label>
      <fieldset className="field"><span>Quem faz este serviço</span>
        <div className="checks">
          {barbers.map((b) => <label key={b.id} className="check"><input type="checkbox" name="barbers[]" value={b.id} defaultChecked={sv ? sv.barbers.includes(b.id) : true} />{b.name}</label>)}
          {!barbers.length && <small className="muted">Cadastre os barbeiros para marcar quem faz.</small>}
        </div>
      </fieldset>
      <Submit>Salvar serviço</Submit>
    </ActionForm>
  );
}

export default async function ServicesPage() {
  const s = await requireSession(ADMIN);
  const { services, barbers } = await withTenant(s, async (tx) => ({
    services: await tx.q(`select s.*, coalesce((select array_agg(barber_id) from barber_services where service_id = s.id), '{}') barbers from services s order by active desc, name`),
    barbers: await tx.q(`select id, name from barbers where active order by name`),
  }));
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Serviços</h1><p>A duração de cada serviço define os horários livres na agenda.</p></div>
        <Modal label="Novo serviço" title="Novo serviço" className="btn btn-primary"><Form barbers={barbers} /></Modal>
      </div>
      <div className="card">
        {services.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Serviço</th><th>Preço</th><th>Duração</th><th className="hide-sm">Comissão</th><th className="hide-sm">Barbeiros</th><th></th></tr></thead>
            <tbody>
              {services.map((sv) => (
                <tr key={sv.id}>
                  <td><strong>{sv.name}</strong>{!sv.active && <span className="badge"> Inativo</span>}</td>
                  <td className="num">{brl(sv.price)}</td>
                  <td className="num">{sv.duration_min} min</td>
                  <td className="num hide-sm">{sv.commission_pct == null ? 'do barbeiro' : `${sv.commission_pct}%`}</td>
                  <td className="hide-sm">{sv.barbers.length}</td>
                  <td><div className="row">
                    <Modal label="Editar" title={sv.name} className="btn btn-sm"><Form sv={sv} barbers={barbers} /></Modal>
                    <ActionForm action={toggleService} className=""><input type="hidden" name="id" value={sv.id} /><Submit className="btn btn-sm">{sv.active ? 'Desativar' : 'Reativar'}</Submit></ActionForm>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <p className="empty">Nenhum serviço ainda. Cadastre o primeiro, por exemplo Corte, R$ 40, 30 minutos.</p>}
      </div>
    </div>
  );
}
