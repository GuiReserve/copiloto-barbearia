'use server';
import { z } from 'zod';
import { ADMIN, ALL, STAFF } from '@/lib/auth';
import { AppError, audit, run, v, type State } from '@/lib/action';
import { hashPassword, verifyPassword } from '@/lib/password';
import { TEMPLATE_KINDS } from '@/integrations/messaging';
import { TIMEZONES } from '@/lib/format';

export async function saveShop(_: State, fd: FormData) {
  const schema = z.object({
    name: v.text('o nome da barbearia'), phone: v.phone,
    slug: z.string('Informe o endereço público.').trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Endereço público: use só letras minúsculas, números e hífen.').min(3, 'Endereço público: mínimo 3 caracteres.').max(40),
    public_booking: z.string().optional(), booking_days: v.int('os dias de antecedência', 1, 60), timezone: z.enum(TIMEZONES, 'Fuso inválido.'),
    slot_minutes: v.int('o intervalo da agenda', 5, 120), offer_expiry_minutes: v.int('a validade do convite', 5, 1440),
    auto_offer: z.enum(['manual', 'primeiro', 'todos']),
    inactive_days: v.int('os dias para inativo', 7, 365), lost_days: v.int('os dias para perdido', 14, 730), vip_visits: v.int('as visitas para VIP', 2, 500),
  });
  return run(ADMIN, schema, fd, async (d, tx, s) => {
    if (d.lost_days <= d.inactive_days) throw new AppError('"Perdido" precisa ter mais dias que "inativo".');
    await tx.q(`update barbershops set name = $1, slug = $2 where id = app_shop()`, [d.name, d.slug]);
    await tx.q(`update settings set phone=$1, timezone=$2, slot_minutes=$3, offer_expiry_minutes=$4, auto_offer=$5, inactive_days=$6, lost_days=$7, vip_visits=$8, public_booking=$9, booking_days=$10`,
      [d.phone ?? null, d.timezone, d.slot_minutes, d.offer_expiry_minutes, d.auto_offer, d.inactive_days, d.lost_days, d.vip_visits, !!d.public_booking, d.booking_days]);
    await audit(tx, s, 'configuracoes.alteradas');
  });
}

export async function saveTemplate(_: State, fd: FormData) {
  const schema = z.object({ kind: z.enum(Object.keys(TEMPLATE_KINDS) as [string, ...string[]]), body: v.text('a mensagem', 1000) });
  return run(ADMIN, schema, fd, async (d, tx) => {
    await tx.q(`update message_templates set body = $2 where kind = $1`, [d.kind, d.body]);
  });
}

export async function addBlock(_: State, fd: FormData) {
  const schema = z.object({
    kind: z.enum(['bloqueio', 'folga', 'feriado']), barber_id: v.id.optional(), date: v.date, date_end: v.date.optional(),
    from: v.time.optional(), to: v.time.optional(), reason: v.opt(120),
  });
  return run(STAFF, schema, fd, async (d, tx, s) => {
    const end = d.date_end ?? d.date;
    if (end < d.date) throw new AppError('A data final precisa ser depois da inicial.');
    if ((d.from && !d.to) || (!d.from && d.to)) throw new AppError('Informe o horário de início e de fim, ou deixe os dois em branco para o dia inteiro.');
    if (d.from && d.to && d.date === end && d.to <= d.from) throw new AppError('O fim precisa ser depois do início.');
    await tx.q(
      `insert into time_blocks (barbershop_id, barber_id, kind, starts_at, ends_at, reason)
       values (app_shop(), $1, $2, ($3::date + $4::time)::timestamptz, case when $6::time is null then ($5::date + 1)::timestamptz else ($5::date + $6::time)::timestamptz end, $7)`,
      [d.barber_id ?? null, d.kind, d.date, d.from ?? '00:00', end, d.to ?? null, d.reason ?? null]);
    await audit(tx, s, 'bloqueio.criado', 'time_block', undefined, { de: d.date, ate: end });
  });
}
export async function removeBlock(_: State, fd: FormData) {
  return run(STAFF, z.object({ id: v.id }), fd, async (d, tx) => { await tx.q(`delete from time_blocks where id = $1`, [d.id]); });
}

export async function addSource(_: State, fd: FormData) {
  return run(ADMIN, z.object({ name: v.text('o nome', 40), kind: z.enum(['instagram', 'google', 'indicacao', 'outro']).default('outro') }), fd, async (d, tx) => {
    await tx.q(`insert into marketing_sources (barbershop_id, name, kind) values (app_shop(), $1, $2)`, [d.name, d.kind]);
  });
}
export async function toggleSource(_: State, fd: FormData) {
  return run(ADMIN, z.object({ id: v.id }), fd, async (d, tx) => { await tx.q(`update marketing_sources set active = not active where id = $1`, [d.id]); });
}

// ── equipe ──
export async function addUser(_: State, fd: FormData) {
  const schema = z.object({ name: v.text('o nome'), email: v.email, role: z.enum(['admin', 'barbeiro', 'recepcao']), barber_id: v.id.optional(), password: v.password });
  return run(ADMIN, schema, fd, async (d, tx, s) => {
    if (d.role === 'barbeiro' && !d.barber_id) throw new AppError('Escolha qual barbeiro este usuário é.');
    const r = await tx.one(
      `insert into users (barbershop_id, barber_id, name, email, password_hash, role) values (app_shop(), $1,$2,$3,$4,$5)
       on conflict (email) do nothing returning id`,
      [d.role === 'barbeiro' ? d.barber_id : null, d.name, d.email, await hashPassword(d.password), d.role]);
    if (!r) throw new AppError('Não foi possível usar este e-mail.');
    await audit(tx, s, 'usuario.criado', 'user', r.id, { papel: d.role });
  });
}

export async function toggleUser(_: State, fd: FormData) {
  return run(ADMIN, z.object({ id: v.id }), fd, async (d, tx, s) => {
    if (d.id === s.userId) throw new AppError('Você não pode desativar o próprio acesso.');
    await tx.q(`update users set active = not active where id = $1`, [d.id]);
    await audit(tx, s, 'usuario.ativado_ou_desativado', 'user', d.id);
  });
}

export async function resetUserPassword(_: State, fd: FormData) {
  return run(ADMIN, z.object({ id: v.id, password: v.password }), fd, async (d, tx, s) => {
    const r = await tx.one(`select auth_set_password($1, $2, null) ok`, [d.id, await hashPassword(d.password)]);
    if (!r?.ok) throw new AppError('Usuário não encontrado.');
    await audit(tx, s, 'usuario.senha_redefinida', 'user', d.id);
  });
}

export async function changeOwnPassword(_: State, fd: FormData) {
  return run(ALL, z.object({ current: z.string('Informe a senha atual.').max(200), password: v.password }), fd, async (d, tx, s) => {
    const h = await tx.one(`select auth_own_hash() h`);
    if (!(await verifyPassword(d.current, h?.h))) throw new AppError('A senha atual não confere.');
    await tx.q(`select auth_set_password($1, $2, $3)`, [s.userId, await hashPassword(d.password), s.tokenHash]);
    await audit(tx, s, 'usuario.senha_alterada', 'user', s.userId);
  });
}
