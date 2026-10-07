import { brl0, num, pct, ratio } from '@/lib/format';

export type FunnelData = { views: number; interactions: number; leads: number; agendamentos: number; atendimentos: number; recorrentes: number; receita: number };
export const sumFunnel = (rows: any[]): FunnelData => rows.reduce((a, r) => ({
  views: a.views + r.views, interactions: a.interactions + r.interactions, leads: a.leads + r.leads, agendamentos: a.agendamentos + r.agendamentos,
  atendimentos: a.atendimentos + r.atendimentos, recorrentes: a.recorrentes + r.recorrentes, receita: a.receita + r.receita,
}), { views: 0, interactions: 0, leads: 0, agendamentos: 0, atendimentos: 0, recorrentes: 0, receita: 0 });

/** Visualizações → Interações → Leads → Agendamentos → Atendimentos → Recorrentes → Faturamento */
export function Funnel({ f }: { f: FunnelData }) {
  const steps: [string, number][] = [['Visualizações', f.views], ['Interações', f.interactions], ['Leads', f.leads],
    ['Agendamentos', f.agendamentos], ['Atendimentos', f.atendimentos], ['Recorrentes', f.recorrentes]];
  const max = Math.max(1, ...steps.map(([, v]) => v));
  return (
    <div className="funnel">
      {steps.map(([label, value], i) => {
        const prev = i > 0 ? steps[i - 1][1] : 0;
        return (
          <div className="funnel-step" key={label}>
            <span>{label}</span>
            {/* escala em raiz quadrada: 10.000 visualizações não escondem 25 atendimentos */}
            <progress value={Math.sqrt(value)} max={Math.sqrt(max)} aria-label={label} />
            <span className="num"><strong>{num(value)}</strong>{i > 0 && prev > 0 && value <= prev && <small> {pct(ratio(value, prev))}</small>}</span>
          </div>
        );
      })}
      <div className="funnel-step"><span>Faturamento</span><span /><strong className="num money">{brl0(f.receita)}</strong></div>
      <p className="small muted">O percentual é a conversão em relação à etapa anterior. Visualizações, interações e leads são os números que você lança em Marketing.</p>
    </div>
  );
}
