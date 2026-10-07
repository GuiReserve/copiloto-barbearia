import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { withTenant } from '@/lib/db';
import { audit } from '@/lib/action';
import { parsePeriod, today } from '@/lib/metrics';
import { terms } from '@/lib/terms';

// Células que começam com = + - @ viram fórmula no Excel: neutraliza (injeção de CSV).
const cell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s || s.role !== 'admin') return new Response('Sem permissão', { status: 403 });
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const { rows, p } = await withTenant(s, async (tx) => {
    const p = parsePeriod(sp, await today(tx));
    await audit(tx, s, 'relatorio.exportado', undefined, undefined, { de: p.from, ate: p.to });
    return {
      p, rows: await tx.q(
        `select to_char(a.starts_at, 'DD/MM/YYYY') dia, to_char(a.starts_at, 'HH24:MI') hora, c.name cliente, b.name barbeiro, sv.name servico,
                a.status, replace(a.price::text, '.', ',') valor
         from appointments a join clients c on c.id = a.client_id join barbers b on b.id = a.barber_id join services sv on sv.id = a.service_id
         where a.starts_at >= $1::date and a.starts_at < ($2::date + 1) order by a.starts_at`, [p.from, p.to]),
    };
  });
  const head = ['Dia', 'Hora', 'Cliente', terms(s.kind).Pro, 'Serviço', 'Situação', 'Valor'];
  const csv = '﻿' + [head, ...rows.map((r) => [r.dia, r.hora, r.cliente, r.barbeiro, r.servico, r.status, r.valor])].map((l) => l.map(cell).join(';')).join('\r\n');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="atendimentos-${p.from}-a-${p.to}.csv"`, 'Cache-Control': 'no-store' } });
}
