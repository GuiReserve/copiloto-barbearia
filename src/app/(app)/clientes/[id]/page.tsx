import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { terms } from '@/lib/terms';
import { withTenant } from '@/lib/db';
import { brl, dmyFull, isUuid, STATUS } from '@/lib/format';
import { CLASSES, CLIENT_STATS } from '@/lib/metrics';
import { TEMPLATE_KINDS, whatsappLink } from '@/integrations/messaging';
import { ActionForm, CopyButton, Modal, Submit } from '@/components/ui';
import { ClientForm, lookups } from '@/components/client-form';
import { deleteClient, messageClient } from '../actions';

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const staff = s.role !== 'barbeiro';
  const d = await withTenant(s, async (tx) => {
    const c = await tx.one(`select x.*, ms.name source, b.name barber, sv.name service from (${CLIENT_STATS}) x
      left join marketing_sources ms on ms.id = x.source_id left join barbers b on b.id = x.preferred_barber_id
      left join services sv on sv.id = x.preferred_service_id where x.id = $1`, [id]);
    if (!c) return null;
    return {
      c, lk: await lookups(tx),
      history: await tx.q(`select a.id, a.status, a.price::float8 price, to_char(a.starts_at, 'DD/MM/YYYY') dia, a.starts_at::date::text iso, to_char(a.starts_at, 'HH24:MI') hora, b.name barber, sv.name service
                           from appointments a join barbers b on b.id = a.barber_id join services sv on sv.id = a.service_id where a.client_id = $1 order by a.starts_at desc limit 100`, [id]),
      messages: staff ? await tx.q(`select id, kind, body, status, to_char(created_at, 'DD/MM HH24:MI') quando from messages where client_id = $1 order by created_at desc limit 20`, [id]) : [],
    };
  });
  if (!d) notFound();
  const { c } = d;
  return (
    <div className="stack">
      <div className="page-head">
        <div><p className="small"><Link href="/clientes">Clientes</Link></p><h1>{c.name} <span className={`badge b-${c.classe}`}>{CLASSES[c.classe]}</span></h1><p>{c.phone ?? 'Sem telefone'}{c.instagram && ` · @${c.instagram}`}{c.email && ` · ${c.email}`}</p></div>
        {staff && <div className="row">
          <Link className="btn btn-primary" href={`/agenda?novo=1&c=${c.id}`}>Agendar</Link>
          <Modal label="Editar" title="Editar cliente"><ClientForm c={c} lk={d.lk} t={terms(s.kind)} /></Modal>
        </div>}
      </div>
      <dl className="stats">
        <div className="stat"><dt>Atendimentos</dt><dd>{c.visits}</dd></div>
        <div className="stat"><dt>Total gasto</dt><dd className="money">{brl(c.spent)}</dd></div>
        <div className="stat"><dt>Ticket médio</dt><dd>{brl(c.visits ? c.spent / c.visits : 0)}</dd></div>
        <div className="stat"><dt>Primeiro atendimento</dt><dd>{c.first_visit ? dmyFull(c.first_visit) : 'Ainda não veio'}</dd></div>
        <div className="stat"><dt>Último atendimento</dt><dd>{c.last_visit ? dmyFull(c.last_visit) : 'Ainda não veio'}</dd></div>
      </dl>
      <div className="grid cols-main">
        <section className="card"><h2>Histórico</h2>
          <div className="list">
            {d.history.map((a) => (
              <div className="item" key={a.id}>
                <Link className="when" href={`/agenda?d=${a.iso}`}>{a.dia.slice(0, 5)}</Link>
                <span className="grow">{a.service} com {a.barber}<br /><span className="muted small">{a.dia} às {a.hora}</span></span>
                <span className={`badge b-${a.status}`}>{STATUS[a.status]}</span>
                <span className="num">{brl(a.price)}</span>
              </div>
            ))}
            {!d.history.length && <p className="empty">Nenhum agendamento até agora.</p>}
          </div>
        </section>
        <div className="stack">
          <section className="card stack-sm"><h2>Preferências</h2>
            <p>{terms(s.kind).Pro}: {c.barber ?? 'tanto faz'}</p><p>Serviço: {c.service ?? 'nenhum'}</p>
            {c.birth_date && <p>Nascimento: {dmyFull(c.birth_date)}</p>}
            {c.notes && <p className="msg">{c.notes}</p>}
          </section>
          {staff && (
            <section className="card stack-sm" id="mensagens"><h2>Mensagens</h2>
              <ActionForm action={messageClient} className="row">
                <input type="hidden" name="client_id" value={c.id} />
                <select name="kind" defaultValue={c.classe === 'inativo' || c.classe === 'perdido' ? 'inativo' : 'lembrete'} aria-label="Modelo" className="grow">
                  {Object.entries(TEMPLATE_KINDS).filter(([k]) => k !== 'encaixe').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <Submit className="btn">Gerar mensagem</Submit>
              </ActionForm>
              <div className="list">
                {d.messages.map((m) => {
                  const wa = whatsappLink(c.phone, m.body);
                  return (
                    <div key={m.id} className="stack-sm">
                      <p className="small muted">{TEMPLATE_KINDS[m.kind] ?? m.kind} · {m.quando}</p>
                      <p className="msg">{m.body}</p>
                      <div className="row"><CopyButton text={m.body} />{wa && <a className="btn btn-sm" href={wa} target="_blank" rel="noopener noreferrer">Abrir no WhatsApp</a>}</div>
                    </div>
                  );
                })}
                {!d.messages.length && <p className="empty">Nenhuma mensagem gerada.</p>}
              </div>
            </section>
          )}
          {s.role === 'admin' && !d.history.length && (
            <ActionForm action={deleteClient}><input type="hidden" name="id" value={c.id} /><Submit className="btn btn-danger">Excluir cliente</Submit></ActionForm>
          )}
        </div>
      </div>
    </div>
  );
}
