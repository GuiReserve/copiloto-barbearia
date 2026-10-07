'use server';
import { z } from 'zod';
import { redirect } from 'next/navigation';
import { clientIp } from '@/lib/auth';
import { withTenant } from '@/lib/db';
import { v, type State } from '@/lib/action';
import { publicSession, publicShop } from '@/lib/public';
import { freeByBarber, startTimes } from '@/lib/slots';
import { toMin } from '@/lib/format';

const person = {
  slug: z.string().max(40), s: v.id, d: v.date,
  name: v.text('o seu nome', 60).refine((n) => n.length >= 2, 'Informe o seu nome.'),
  phone: z.string('Informe o seu WhatsApp.').trim().regex(/^[\d\s()+-]{8,20}$/, 'Telefone inválido.')
    .refine((p) => p.replace(/\D/g, '').length >= 10, 'Informe o telefone com DDD.'),
};
const MSG: Record<string, string> = {
  invalido: 'Não foi possível marcar esse horário. Volte e escolha de novo.',
  limite: 'Muitos pedidos seguidos a partir desta conexão. Tente mais tarde ou entre em contato pelo telefone.',
  muitos: 'Você já tem dois horários marcados. Para marcar outro, entre em contato pelo telefone.',
  ocupado: 'Alguém acabou de pegar esse horário. Escolha outro.',
};
const fields = (fd: FormData) => Object.fromEntries([...fd].filter(([k, x]) => !k.startsWith('$') && x !== ''));

export async function book(_: State, fd: FormData): Promise<State> {
  const p = z.object({ ...person, b: v.id, h: v.time }).safeParse(fields(fd));
  if (!p.success) return { error: p.error.issues[0].message };
  const d = p.data, shop = await publicShop(d.slug);
  if (!shop?.public_booking) return { error: MSG.invalido };
  const ip = await clientIp();
  const result = await withTenant(publicSession(shop), async (tx) => {
    // o servidor refaz a conta: o horário pedido precisa estar entre os livres de verdade
    const sv = await tx.one(`select duration_min from services where id = $1 and active`, [d.s]);
    if (!sv) return 'invalido';
    const { free } = await freeByBarber(tx, d.d, d.b);
    if (!startTimes(free.get(d.b) ?? [], sv.duration_min, shop.slot_minutes).includes(toMin(d.h))) return 'ocupado';
    return (await tx.one(`select public_book($1,$2,$3,$4,$5,$6,$7,$8) r`, [shop.id, d.s, d.b, d.d, d.h, d.name, d.phone, ip]))!.r as string;
  });
  if (result !== 'ok') return { error: MSG[result] ?? MSG.invalido };
  redirect(`/b/${d.slug}?ok=1&s=${d.s}&d=${d.d}&h=${d.h}`);
}

export async function joinQueue(_: State, fd: FormData): Promise<State> {
  const p = z.object({ ...person, b: v.id.optional(), from: v.time, to: v.time }).safeParse(fields(fd));
  if (!p.success) return { error: p.error.issues[0].message };
  const d = p.data, shop = await publicShop(d.slug);
  if (!shop?.public_booking) return { error: MSG.invalido };
  if (d.to <= d.from) return { error: 'O horário final precisa ser depois do inicial.' };
  const ip = await clientIp();
  const result = await withTenant(publicSession(shop), async (tx) =>
    (await tx.one(`select public_wait($1,$2,$3,$4,$5,$6,$7,$8,$9) r`, [shop.id, d.s, d.b ?? null, d.d, d.from, d.to, d.name, d.phone, ip]))!.r as string);
  if (result !== 'ok') return { error: MSG[result] ?? MSG.invalido };
  redirect(`/b/${d.slug}?fila=1&d=${d.d}`);
}
