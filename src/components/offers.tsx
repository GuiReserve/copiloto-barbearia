import type { Tx } from '@/lib/db';
import { whatsappLink } from '@/integrations/messaging';
import { ActionForm, CopyButton, Submit } from './ui';
import { acceptOffer, declineOffer } from '@/app/(app)/fila/actions';

export const OFFER: Record<string, string> = { enviado: 'Aguardando resposta', aceitou: 'Aceitou', recusou: 'Recusou', expirou: 'Expirou' };

export async function loadOffers(tx: Tx, where: string, params: unknown[]) {
  return tx.q(
    `select o.id, o.status, to_char(o.starts_at, 'DD/MM') dia, to_char(o.starts_at, 'HH24:MI') hora, to_char(o.expires_at, 'HH24:MI') expira,
            c.name client, c.phone, b.name barber, sv.name service, m.body
     from waiting_list_offers o join waiting_list w on w.id = o.waiting_id join clients c on c.id = w.client_id
     join services sv on sv.id = w.service_id join barbers b on b.id = o.barber_id
     left join lateral (select body from messages where offer_id = o.id order by created_at desc limit 1) m on true
     where ${where} order by o.created_at desc limit 30`, params);
}

export function OfferList({ offers }: { offers: any[] }) {
  return (
    <div className="list">
      {offers.map((o) => {
        const wa = o.body ? whatsappLink(o.phone, o.body) : null;
        return (
          <div key={o.id} className="stack-sm">
            <div className="item">
              <span className="when">{o.hora}</span>
              <span className="grow"><strong>{o.client}</strong><br /><span className="muted small">{o.service} com {o.barber}, {o.dia}{o.status === 'enviado' && ` · convite vale até ${o.expira}`}</span></span>
              <span className={`badge b-${o.status}`}>{OFFER[o.status]}</span>
            </div>
            {o.status === 'enviado' && o.body && (
              <>
                <p className="msg">{o.body}</p>
                <div className="row">
                  {wa && <a className="btn btn-sm btn-primary" href={wa} target="_blank" rel="noopener noreferrer">Abrir no WhatsApp</a>}
                  <CopyButton text={o.body} />
                  <ActionForm action={acceptOffer} className=""><input type="hidden" name="id" value={o.id} /><Submit className="btn btn-sm btn-ok">Confirmar encaixe</Submit></ActionForm>
                  <ActionForm action={declineOffer} className=""><input type="hidden" name="id" value={o.id} /><Submit className="btn btn-sm">Recusou</Submit></ActionForm>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
