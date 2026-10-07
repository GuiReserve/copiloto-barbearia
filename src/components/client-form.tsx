import { ActionForm, Submit } from './ui';
import { saveClient } from '@/app/(app)/clientes/actions';

export type Lookups = { barbers: any[]; services: any[]; sources: any[] };

export function ClientForm({ c, lk }: { c?: any; lk: Lookups }) {
  return (
    <ActionForm action={saveClient}>
      {c && <input type="hidden" name="id" value={c.id} />}
      <label className="field"><span>Nome</span><input name="name" defaultValue={c?.name} required maxLength={80} /></label>
      <div className="form-2">
        <label className="field"><span>Telefone (WhatsApp)</span><input name="phone" inputMode="tel" defaultValue={c?.phone ?? ''} placeholder="(11) 91234-5678" /></label>
        <label className="field"><span>Como chegou até aqui</span><select name="source_id" defaultValue={c?.source_id ?? ''}><option value="">Não sei</option>{lk.sources.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label className="field"><span>E-mail</span><input name="email" type="email" defaultValue={c?.email ?? ''} /></label>
        <label className="field"><span>Nascimento</span><input name="birth_date" type="date" defaultValue={c?.birth_date ?? ''} /></label>
        <label className="field"><span>Instagram</span><input name="instagram" defaultValue={c?.instagram ?? ''} placeholder="@usuario" /></label>
        <label className="field"><span>Barbeiro preferido</span><select name="preferred_barber_id" defaultValue={c?.preferred_barber_id ?? ''}><option value="">Tanto faz</option>{lk.barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      </div>
      <label className="field"><span>Serviço preferido</span><select name="preferred_service_id" defaultValue={c?.preferred_service_id ?? ''}><option value="">Nenhum</option>{lk.services.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="field"><span>Observações</span><textarea name="notes" defaultValue={c?.notes ?? ''} maxLength={1000} /></label>
      <Submit>Salvar cliente</Submit>
    </ActionForm>
  );
}

export async function lookups(tx: import('@/lib/db').Tx): Promise<Lookups> {
  return {
    barbers: await tx.q(`select id, name from barbers where active order by name`),
    services: await tx.q(`select id, name, price::float8 price, duration_min from services where active order by name`),
    sources: await tx.q(`select id, name from marketing_sources where active order by name`),
  };
}
