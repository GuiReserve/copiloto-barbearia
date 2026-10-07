'use server';
import { z } from 'zod';
import { ADMIN, STAFF } from '@/lib/auth';
import { AppError, audit, run, v, type State } from '@/lib/action';
import { createMessage, TEMPLATE_KINDS } from '@/integrations/messaging';

const schema = z.object({
  id: v.id.optional(), name: v.text('o nome'), phone: v.phone, email: v.email.optional(), birth_date: v.date.optional(),
  instagram: z.string().trim().regex(/^@?[\w.]{1,30}$/, 'Instagram inválido.').optional(), notes: v.opt(1000),
  preferred_barber_id: v.id.optional(), preferred_service_id: v.id.optional(), source_id: v.id.optional(),
});

export async function saveClient(_: State, fd: FormData) {
  return run(STAFF, schema, fd, async (d, tx, s) => {
    const args = [d.name, d.phone ?? null, d.email ?? null, d.birth_date ?? null, d.instagram?.replace(/^@/, '') ?? null, d.notes ?? null,
      d.preferred_barber_id ?? null, d.preferred_service_id ?? null, d.source_id ?? null];
    const row = d.id
      ? await tx.one(`update clients set name=$2, phone=$3, email=$4, birth_date=$5, instagram=$6, notes=$7, preferred_barber_id=$8, preferred_service_id=$9, source_id=$10 where id=$1 returning id`, [d.id, ...args])
      : await tx.one(`insert into clients (barbershop_id, name, phone, email, birth_date, instagram, notes, preferred_barber_id, preferred_service_id, source_id)
                      values (app_shop(), $1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`, args);
    if (!row) throw new AppError('Cliente não encontrado.');
    await audit(tx, s, d.id ? 'cliente.alterado' : 'cliente.criado', 'client', row.id);
    if (!d.id) return { redirect: `/clientes/${row.id}` };
  });
}

/** Exclusão definitiva (pedido do titular dos dados). Só funciona para quem não tem histórico de atendimento. */
export async function deleteClient(_: State, fd: FormData) {
  return run(ADMIN, z.object({ id: v.id }), fd, async (d, tx, s) => {
    await tx.q(`delete from waiting_list where client_id = $1`, [d.id]);
    await tx.q(`delete from clients where id = $1`, [d.id]);
    await audit(tx, s, 'cliente.excluido', 'client', d.id);
    return { redirect: '/clientes' };
  });
}

export async function messageClient(_: State, fd: FormData) {
  const schema = z.object({ client_id: v.id, kind: z.enum(Object.keys(TEMPLATE_KINDS) as [string, ...string[]]), appointment_id: v.id.optional() });
  return run(STAFF, schema, fd, async (d, tx, s) => {
    let vars: Record<string, string> = {};
    if (d.appointment_id) {
      const a = await tx.one(`select to_char(a.starts_at, 'DD/MM') data, to_char(a.starts_at, 'HH24:MI') horario, b.name barbeiro, sv.name servico
                              from appointments a join barbers b on b.id = a.barber_id join services sv on sv.id = a.service_id where a.id = $1 and a.client_id = $2`, [d.appointment_id, d.client_id]);
      if (a) vars = a as Record<string, string>;
    }
    const m = await createMessage(tx, s, { clientId: d.client_id, kind: d.kind, vars, appointmentId: d.appointment_id });
    if (!m) throw new AppError('Cliente ou modelo de mensagem não encontrado.');
    return { redirect: `/clientes/${d.client_id}#mensagens` };
  });
}
