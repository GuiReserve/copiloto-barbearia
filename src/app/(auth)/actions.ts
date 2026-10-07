'use server';
import { z } from 'zod';
import { redirect } from 'next/navigation';
import { sys } from '@/lib/db';
import { clientIp, endSession, getSession, hashToken, startSession } from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/password';
import { v, type State } from '@/lib/action';

// e-mail: sem espaços nas pontas (teclado do celular costuma colar um espaço) e em minúsculas
const email = z.preprocess((x) => (typeof x === 'string' ? x.trim() : x), v.email);
const loginSchema = z.object({ email, password: z.string().min(1).max(200) });

export async function login(_: State, fd: FormData): Promise<State> {
  const p = loginSchema.safeParse({ email: fd.get('email'), password: fd.get('password') });
  if (!p.success) return { error: 'Informe um e-mail válido e a senha.' };
  const ip = await clientIp();
  const [gate] = await sys(`select auth_login_allowed($1, $2) ok`, [p.data.email, ip]);
  if (!gate.ok) return { error: 'Muitas tentativas seguidas. Aguarde 15 minutos, ou use "Esqueci a senha" se tiver o código de recuperação.' };
  const [u] = await sys(`select * from auth_user_for_login($1)`, [p.data.email]);
  const ok = await verifyPassword(p.data.password, u?.password_hash);
  await sys(`select auth_login_record($1, $2, $3)`, [p.data.email, ip, ok]);
  if (!ok) return { error: 'E-mail ou senha incorretos. Toque em "Mostrar" para conferir o que foi digitado.' };
  await startSession(u.user_id);
  redirect('/dashboard');
}

const registerSchema = z.object({
  kind: z.enum(['barbearia', 'sobrancelha'], 'Escolha o tipo de negócio.'),
  shop: v.text('o nome do negócio'), name: v.text('o seu nome'), email, password: v.password, password2: z.string('Repita a senha.'),
});

export async function register(_: State, fd: FormData): Promise<State> {
  const p = registerSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0].message };
  if (p.data.password !== p.data.password2) return { error: 'As duas senhas não são iguais. Toque em "Mostrar" para conferir.' };
  let userId: string | null;
  try {
    const [r] = await sys(`select auth_register_v2($1, $2, $3, $4, $5, $6) id`,
      [p.data.shop, p.data.name, p.data.email, await hashPassword(p.data.password), await clientIp(), p.data.kind]);
    userId = r.id;
  } catch {
    return { error: 'Muitas contas criadas a partir desta conexão. Tente mais tarde.' };
  }
  if (!userId) return { error: 'Não foi possível criar a conta com este e-mail. Se já tem cadastro, entre com a sua senha.' };
  await startSession(userId);
  redirect('/configuracoes?inicio=1');
}

const recoverSchema = z.object({
  email, code: z.string('Informe o código.').transform((c) => c.toUpperCase().replace(/[^A-Z0-9]/g, '')).refine((c) => c.length === 20, 'O código tem 20 letras e números.'),
  password: v.password, password2: z.string('Repita a senha.'),
});

/** Esqueci a senha: e-mail + código de recuperação (uso único) → senha nova. */
export async function recover(_: State, fd: FormData): Promise<State> {
  const p = recoverSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0].message };
  if (p.data.password !== p.data.password2) return { error: 'As duas senhas não são iguais.' };
  const ip = await clientIp();
  const [gate] = await sys(`select auth_login_allowed($1, $2) ok`, [p.data.email, ip]);
  if (!gate.ok) return { error: 'Muitas tentativas seguidas. Aguarde 15 minutos.' };
  const [r] = await sys(`select auth_recover($1, $2, $3, $4) ok`, [p.data.email, hashToken(p.data.code), await hashPassword(p.data.password), ip]);
  if (!r.ok) return { error: 'E-mail ou código de recuperação incorretos.' };
  redirect('/login?senha=nova');
}

export async function logout() {
  const kind = (await getSession())?.kind;
  await endSession();
  redirect(kind === 'sobrancelha' ? '/login?tipo=sobrancelha' : '/login');
}
