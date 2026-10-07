import 'server-only';
import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { clientIp, getSession, type Role, type Session } from './auth';
import { withTenant, type Tx } from './db';

export type State = { ok?: boolean; error?: string; at?: number } | null;
export class AppError extends Error {}

function formToObject(fd: FormData) {
  const o: Record<string, unknown> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith('$')) continue;
    if (key.endsWith('[]')) o[key.slice(0, -2)] = fd.getAll(key).filter((v) => v !== '');
    else { const v = fd.get(key); if (typeof v === 'string' && v.trim() !== '') o[key] = v; }
  }
  return o;
}

function friendly(e: any): string {
  if (e instanceof AppError) return e.message;
  switch (e?.code) {
    case '23P01': return 'Esse horário já está ocupado para este barbeiro.';
    case '23505': return 'Já existe um registro com esses dados.';
    case '23503': return 'Não dá para excluir: existem registros ligados a este item.';
    case '23514': return 'Algum valor está fora do permitido. Revise os campos.';
    case '42501': return 'Sem permissão para esta ação.';
    case 'P0001': return e.message;
  }
  console.error('[action]', e);
  return 'Não foi possível concluir. Tente de novo.';
}

export async function audit(tx: Tx, s: Session, action: string, entity?: string, entityId?: string, detail?: unknown) {
  await tx.q(
    `insert into audit_log (barbershop_id, user_id, action, entity, entity_id, detail, ip) values ($1,$2,$3,$4,$5,$6,$7)`,
    [s.shopId, s.userId, action, entity ?? null, entityId ?? null, detail ? JSON.stringify(detail) : null, await clientIp()],
  );
}

/**
 * Toda ação do servidor passa por aqui: sessão válida → papel autorizado → dados validados
 * → transação com RLS. O frontend nunca é a barreira de segurança.
 */
export async function run<S extends z.ZodType>(
  roles: Role[], schema: S, fd: FormData,
  fn: (data: z.infer<S>, tx: Tx, s: Session) => Promise<{ redirect?: string } | void>,
): Promise<State> {
  const s = await getSession();
  if (!s) redirect('/login');
  if (!roles.includes(s.role)) return { error: 'Sem permissão para esta ação.' };
  const parsed = schema.safeParse(formToObject(fd));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  let out: { redirect?: string } | void;
  try {
    out = await withTenant(s, (tx) => fn(parsed.data, tx, s));
  } catch (e) {
    return { error: friendly(e) };
  }
  revalidatePath('/', 'layout');
  if (out?.redirect) redirect(out.redirect);
  return { ok: true, at: Date.now() };
}

// ── validadores reutilizados ──
export const v = {
  id: z.uuid('Seleção inválida.'),
  text: (label: string, max = 80) => z.string(`Preencha ${label}.`).trim().min(1, `Preencha ${label}.`).max(max, `${label}: texto longo demais.`),
  opt: (max = 500) => z.string().trim().max(max, 'Texto longo demais.').optional(),
  date: z.iso.date('Data inválida.'),
  time: z.string('Informe o horário.').regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido.'),
  money: (label = 'o valor') => z.preprocess(
    (x) => (typeof x === 'string' ? (x.includes(',') ? x.replace(/\./g, '').replace(',', '.') : x).replace(/[^\d.]/g, '') : x),
    z.coerce.number(`Informe ${label}.`).min(0, 'Valor inválido.').max(9_999_999, 'Valor alto demais.')),
  int: (label: string, min: number, max: number) => z.coerce.number(`Informe ${label}.`).int().min(min, `${label}: mínimo ${min}.`).max(max, `${label}: máximo ${max}.`),
  pct: z.preprocess((x) => (typeof x === 'string' ? x.replace(',', '.') : x), z.coerce.number().min(0, 'Percentual inválido.').max(100, 'Percentual inválido.')),
  phone: z.string().trim().regex(/^[\d\s()+-]{8,20}$/, 'Telefone inválido.').optional(),
  email: z.email('E-mail inválido.').max(200).transform((e) => e.toLowerCase()),
  password: z.string('Informe a senha.').min(10, 'A senha precisa de pelo menos 10 caracteres.').max(200),
};
