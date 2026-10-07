'use server';
import { z } from 'zod';
import { redirect } from 'next/navigation';
import { sys } from '@/lib/db';
import { clientIp, endSession, startSession } from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/password';
import { v, type State } from '@/lib/action';

const loginSchema = z.object({ email: v.email, password: z.string().min(1).max(200) });

export async function login(_: State, fd: FormData): Promise<State> {
  const p = loginSchema.safeParse({ email: fd.get('email'), password: fd.get('password') });
  if (!p.success) return { error: 'Informe e-mail e senha.' };
  const ip = await clientIp();
  const [gate] = await sys(`select auth_login_allowed($1, $2) ok`, [p.data.email, ip]);
  if (!gate.ok) return { error: 'Muitas tentativas seguidas. Aguarde 15 minutos e tente de novo.' };
  const [u] = await sys(`select * from auth_user_for_login($1)`, [p.data.email]);
  const ok = await verifyPassword(p.data.password, u?.password_hash);
  await sys(`select auth_login_record($1, $2, $3)`, [p.data.email, ip, ok]);
  if (!ok) return { error: 'E-mail ou senha incorretos.' };
  await startSession(u.user_id);
  redirect('/dashboard');
}

const registerSchema = z.object({ shop: v.text('o nome da barbearia'), name: v.text('o seu nome'), email: v.email, password: v.password });

export async function register(_: State, fd: FormData): Promise<State> {
  const p = registerSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0].message };
  let userId: string | null;
  try {
    const [r] = await sys(`select auth_register($1, $2, $3, $4, $5) id`,
      [p.data.shop, p.data.name, p.data.email, await hashPassword(p.data.password), await clientIp()]);
    userId = r.id;
  } catch {
    return { error: 'Muitas contas criadas a partir desta conexão. Tente mais tarde.' };
  }
  if (!userId) return { error: 'Não foi possível criar a conta com este e-mail. Se já tem cadastro, entre com a sua senha.' };
  await startSession(userId);
  redirect('/configuracoes?inicio=1');
}

export async function logout() {
  await endSession();
  redirect('/login');
}
