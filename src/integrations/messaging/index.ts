import 'server-only';
import type { Tx } from '@/lib/db';
import type { Session } from '@/lib/auth';

/**
 * Camada de mensagens. O resto do sistema só conhece esta interface;
 * para ligar o WhatsApp oficial depois, basta criar outro provedor aqui.
 */
export interface MessageProvider {
  id: string;
  /** 'gerada' = pronta para o atendente copiar ou abrir a conversa; 'enviada' = entregue pelo provedor */
  send(msg: { to: string | null; body: string }): Promise<{ status: 'gerada' | 'enviada' | 'falhou' }>;
}

const manual: MessageProvider = { id: 'manual', send: async () => ({ status: 'gerada' }) };
const providers: Record<string, MessageProvider> = { manual };
export const provider = () => providers[process.env.MESSAGING_PROVIDER ?? 'manual'] ?? manual;

export const TEMPLATE_KINDS: Record<string, string> = {
  confirmacao: 'Confirmação', lembrete: 'Lembrete', cancelamento: 'Cancelamento', encaixe: 'Encaixe', inativo: 'Cliente inativo',
};
export const TEMPLATE_VARS = ['cliente', 'barbearia', 'data', 'horario', 'barbeiro', 'servico', 'link'];

export function render(body: string, vars: Record<string, string | undefined>) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '').replace(/[ \t]+/g, ' ').trim();
}

/** Link "abrir conversa" do WhatsApp: gratuito, sem API. */
export function whatsappLink(phone: string | null | undefined, body: string) {
  let d = (phone ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length <= 11) d = `55${d}`;
  return `https://wa.me/${d}?text=${encodeURIComponent(body)}`;
}

export async function createMessage(tx: Tx, s: Session, m: {
  clientId: string; kind: string; vars: Record<string, string | undefined>; appointmentId?: string; offerId?: string;
}) {
  const c = await tx.one(`select name, phone from clients where id = $1`, [m.clientId]);
  const t = await tx.one(`select body from message_templates where kind = $1`, [m.kind]);
  if (!c || !t) return null;
  const body = render(t.body, { cliente: c.name.split(' ')[0], barbearia: s.shopName, ...m.vars });
  const p = provider();
  const { status } = await p.send({ to: c.phone, body });
  await tx.q(
    `insert into messages (barbershop_id, client_id, kind, channel, body, status, appointment_id, offer_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [s.shopId, m.clientId, m.kind, p.id, body, status, m.appointmentId ?? null, m.offerId ?? null, s.userId]);
  return { body, link: whatsappLink(c.phone, body) };
}
