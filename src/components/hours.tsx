import { ActionForm, Submit } from './ui';
import type { State } from '@/lib/action';

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
type Hour = { weekday: number; opens: string; closes: string; break_start: string | null; break_end: string | null };

export function HoursForm({ action, rows, barberId }: { action: (p: State, fd: FormData) => Promise<State>; rows: Hour[]; barberId?: string }) {
  return (
    <ActionForm action={action} done="Horários salvos.">
      {barberId && <input type="hidden" name="barber_id" value={barberId} />}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Dia</th><th>Abre</th><th>Fecha</th><th>Intervalo de</th><th>até</th></tr></thead>
          <tbody>
            {DIAS.map((d, i) => {
              const r = rows.find((x) => x.weekday === i);
              return (
                <tr key={i}>
                  <td><label className="check nowrap"><input type="checkbox" name={`on${i}`} defaultChecked={!!r} />{d}</label></td>
                  <td><input type="time" name={`opens${i}`} defaultValue={r?.opens.slice(0, 5) ?? '09:00'} aria-label={`${d}: abre`} /></td>
                  <td><input type="time" name={`closes${i}`} defaultValue={r?.closes.slice(0, 5) ?? '19:00'} aria-label={`${d}: fecha`} /></td>
                  <td><input type="time" name={`bs${i}`} defaultValue={r?.break_start?.slice(0, 5) ?? ''} aria-label={`${d}: início do intervalo`} /></td>
                  <td><input type="time" name={`be${i}`} defaultValue={r?.break_end?.slice(0, 5) ?? ''} aria-label={`${d}: fim do intervalo`} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div><Submit>Salvar horários</Submit></div>
    </ActionForm>
  );
}
