import { notFound } from 'next/navigation';
import { sys } from '@/lib/db';
import { hashToken } from '@/lib/auth';
import { brl } from '@/lib/format';
import { respond } from './actions';

export const metadata = { title: 'Convite de encaixe', referrer: 'no-referrer' as const };

/** Página pública: o cliente aceita ou recusa o encaixe sem precisar de conta. */
export default async function OfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[\w-]{40,50}$/.test(token)) notFound();
  const [o] = await sys(`select * from offer_public_get($1)`, [hashToken(token)]);
  if (!o) notFound();
  const open = o.status === 'enviado' && !o.expired;
  return (
    <main className="center-page">
      <div className="card">
        <p className="muted">{o.shop_name}</p>
        {open && <>
          <h1>{o.client_name}, abriu um horário para você</h1>
          <dl className="stats">
            <div className="stat lead"><dt>{o.day}</dt><dd>{o.hour}</dd></div>
            <div className="stat"><dt>Com</dt><dd>{o.barber_name}</dd></div>
            <div className="stat"><dt>{o.service_name}</dt><dd>{brl(Number(o.price))}</dd></div>
          </dl>
          <form action={respond} className="form">
            <input type="hidden" name="token" value={token} />
            <button className="btn btn-primary" name="answer" value="sim">Quero este horário</button>
            <button className="btn" name="answer" value="nao">Não vou conseguir</button>
          </form>
        </>}
        {o.status === 'aceitou' && <><h1>Horário confirmado</h1><p>Esperamos você dia {o.day} às {o.hour}, com {o.barber_name}.</p></>}
        {o.status === 'recusou' && <><h1>Tudo bem</h1><p>Você continua podendo marcar outro horário com a gente.</p></>}
        {(o.status === 'expirou' || (o.status === 'enviado' && o.expired)) && <><h1>Este horário já foi preenchido</h1><p>O convite não está mais disponível. Fale com a barbearia para marcar outro horário.</p></>}
      </div>
    </main>
  );
}
