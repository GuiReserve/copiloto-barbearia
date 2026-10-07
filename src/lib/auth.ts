import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash, randomBytes } from 'node:crypto';
import { sys } from './db';
import type { Kind } from './terms';

export type Role = 'admin' | 'barbeiro' | 'recepcao';
export type Session = {
  userId: string; shopId: string; role: Role; barberId: string | null;
  name: string; shopName: string; tz: string; tokenHash: Buffer; kind: Kind;
};

const PROD = process.env.NODE_ENV === 'production';
// __Host-: o navegador só aceita com Secure, Path=/ e sem Domain (não vaza para subdomínios)
const COOKIE = PROD ? '__Host-sessao' : 'sessao';
const sha256 = (v: string) => createHash('sha256').update(v).digest();

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0] ?? 'desconhecido').trim().slice(0, 64);
}

export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const tokenHash = sha256(token);
  const [r] = await sys('select * from auth_session_get($1)', [tokenHash]);
  if (!r) return null;
  return {
    userId: r.user_id, shopId: r.barbershop_id, role: r.role, barberId: r.barber_id,
    name: r.user_name, shopName: r.shop_name, tz: r.timezone, tokenHash, kind: r.kind === 'sobrancelha' ? 'sobrancelha' : 'barbearia',
  };
});

export async function requireSession(roles?: Role[]): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  if (roles && !roles.includes(s.role)) redirect('/dashboard');
  return s;
}

export async function startSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const h = await headers();
  await sys('select auth_session_create($1, $2, $3, $4)', [userId, sha256(token), await clientIp(), h.get('user-agent') ?? '']);
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: PROD, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7 });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await sys('select auth_session_delete($1)', [sha256(token)]);
  // apagar um cookie __Host- exige os mesmos atributos (Secure, Path=/), senão o navegador ignora
  jar.set(COOKIE, '', { httpOnly: true, secure: PROD, sameSite: 'lax', path: '/', maxAge: 0 });
}

export const hashToken = sha256;
export const STAFF: Role[] = ['admin', 'recepcao'];
export const ADMIN: Role[] = ['admin'];
export const ALL: Role[] = ['admin', 'recepcao', 'barbeiro'];
