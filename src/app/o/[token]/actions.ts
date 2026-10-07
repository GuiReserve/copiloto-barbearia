'use server';
import { redirect } from 'next/navigation';
import { sys } from '@/lib/db';
import { hashToken } from '@/lib/auth';

export async function respond(fd: FormData) {
  const token = String(fd.get('token') ?? '');
  if (!/^[\w-]{40,50}$/.test(token)) redirect('/login');
  await sys(`select offer_public_respond($1, $2)`, [hashToken(token), fd.get('answer') === 'sim']);
  redirect(`/o/${token}`);
}
