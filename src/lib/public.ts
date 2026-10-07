import 'server-only';
import { sys } from './db';
import type { Session } from './auth';

export type PublicShop = { id: string; name: string; phone: string | null; timezone: string; public_booking: boolean; booking_days: number; slot_minutes: number; kind: string };

export async function publicShop(slug: string): Promise<PublicShop | null> {
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  const [s] = await sys<PublicShop>(`select * from public_shop($1)`, [slug]);
  return s ?? null;
}

/**
 * Contexto do visitante da página pública: papel "publico" não é admin, recepção nem barbeiro,
 * então o RLS só libera o catálogo (serviços, barbeiros, horários). Clientes, agenda, financeiro
 * e mensagens ficam invisíveis; gravar só pelas funções public_* do banco.
 */
export const publicSession = (shop: PublicShop): Session => ({
  userId: '', shopId: shop.id, role: 'publico' as Session['role'], barberId: null,
  name: 'Visitante', shopName: shop.name, tz: shop.timezone, tokenHash: Buffer.alloc(0), kind: shop.kind === 'sobrancelha' ? 'sobrancelha' : 'barbearia',
});
