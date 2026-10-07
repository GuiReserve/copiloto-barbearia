import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { terms } from '@/lib/terms';
import { withTenant } from '@/lib/db';
import { brl, dmyFull } from '@/lib/format';
import { CLASSES, CLIENT_STATS } from '@/lib/metrics';
import { Modal } from '@/components/ui';
import { ClientForm, lookups } from '@/components/client-form';

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? '').slice(0, 60), classe = sp.classe && sp.classe in CLASSES ? sp.classe : '';
  const staff = s.role !== 'barbeiro';
  const { rows, lk, counts } = await withTenant(s, async (tx) => ({
    rows: await tx.q(`select x.*, ms.name source from (${CLIENT_STATS}) x left join marketing_sources ms on ms.id = x.source_id
                      where ($1 = '' or x.name ilike '%' || $1 || '%' or x.phone ilike '%' || $1 || '%') and ($2 = '' or x.classe = $2)
                      order by x.last_visit desc nulls last, x.name limit 300`, [q.replace(/[%_\\]/g, '\\$&'), classe]),
    counts: await tx.q<{ classe: string; n: number }>(`select classe, count(*)::int n from (${CLIENT_STATS}) x group by classe`),
    lk: await lookups(tx),
  }));
  const n = Object.fromEntries(counts.map((c) => [c.classe, c.n]));
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Clientes</h1><p>{staff ? 'Histórico e frequência de cada cliente.' : 'Clientes que você atende.'}</p></div>
        {staff && <Modal label="Novo cliente" title="Novo cliente" className="btn btn-primary"><ClientForm lk={lk} t={terms(s.kind)} /></Modal>}
      </div>
      <form className="row" action="/clientes">
        <input name="q" defaultValue={q} placeholder="Buscar por nome ou telefone" aria-label="Buscar" className="grow" />
        {classe && <input type="hidden" name="classe" value={classe} />}
        <button className="btn">Buscar</button>
      </form>
      <nav className="seg" aria-label="Classificação">
        <Link href="/clientes" aria-current={!classe ? 'true' : undefined}>Todos</Link>
        {Object.entries(CLASSES).map(([k, l]) => <Link key={k} href={`/clientes?classe=${k}`} aria-current={classe === k ? 'true' : undefined}>{l} {n[k] ?? 0}</Link>)}
      </nav>
      <div className="card">
        {rows.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Cliente</th><th>Situação</th><th>Última visita</th><th className="hide-sm right">Atendimentos</th><th className="hide-sm right">Total gasto</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/clientes/${c.id}`}><strong>{c.name}</strong></Link><br /><span className="muted small">{c.phone ?? 'sem telefone'}</span></td>
                  <td><span className={`badge b-${c.classe}`}>{CLASSES[c.classe]}</span></td>
                  <td className="num">{c.last_visit ? dmyFull(c.last_visit) : <span className="muted">nunca</span>}</td>
                  <td className="num right hide-sm">{c.visits}</td>
                  <td className="num right hide-sm">{brl(c.spent)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <p className="empty">{q || classe ? 'Ninguém encontrado com esse filtro.' : 'Nenhum cliente ainda. Eles aparecem aqui quando você cadastra ou agenda.'}</p>}
      </div>
    </div>
  );
}
