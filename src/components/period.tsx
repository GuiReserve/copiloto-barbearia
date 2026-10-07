import Link from 'next/link';
import { PERIODS, type Period } from '@/lib/metrics';

/** Seletor de período. Tudo via URL: funciona sem JavaScript e dá para compartilhar o link. */
export function PeriodNav({ period, path, extra = '' }: { period: Period; path: string; extra?: string }) {
  return (
    <div className="row">
      <nav className="seg" aria-label="Período">
        {PERIODS.map(([k, label]) => <Link key={k} href={`${path}?p=${k}${extra}`} aria-current={period.key === k ? 'true' : undefined}>{label}</Link>)}
      </nav>
      <details>
        <summary className="btn btn-sm">Personalizado</summary>
        <form className="row" action={path}>
          <input type="hidden" name="p" value="custom" />
          <input type="date" name="de" defaultValue={period.from} aria-label="De" required />
          <input type="date" name="ate" defaultValue={period.to} aria-label="Até" required />
          <button className="btn btn-sm">Aplicar</button>
        </form>
      </details>
    </div>
  );
}

export function Bars({ rows, format, brass }: { rows: { label: string; value: number; hint?: string }[]; format: (n: number) => string; brass?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="empty">Sem dados neste período.</p>;
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <span>{r.label}{r.hint && <span className="muted small"> {r.hint}</span>}</span>
          <strong className="num">{format(r.value)}</strong>
          <progress className={brass ? 'brass' : undefined} value={r.value} max={max} aria-label={r.label} />
        </div>
      ))}
    </div>
  );
}

/** Gráfico de colunas em SVG puro (sem biblioteca, sem estilo inline). */
export function Columns({ data, labels, title, brass }: { data: number[]; labels: [string, string]; title: string; brass?: boolean }) {
  const max = Math.max(1, ...data), w = 100 / Math.max(1, data.length);
  return (
    <figure className="fig">
      <svg className={`chart${brass ? ' brass' : ''}`} viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={title}>
        {data.map((v, i) => {
          const h = v > 0 ? Math.max(2, (v / max) * 96) : 1;
          return <rect key={i} className={v > 0 ? undefined : 'zero'} x={i * w + w * 0.15} y={100 - h} width={w * 0.7} height={h} rx="0.6" />;
        })}
      </svg>
      <figcaption className="chart-axis"><span>{labels[0]}</span><span>{labels[1]}</span></figcaption>
    </figure>
  );
}
