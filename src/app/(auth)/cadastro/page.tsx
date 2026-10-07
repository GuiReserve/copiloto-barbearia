import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { ActionForm, Submit } from '@/components/ui';
import { register } from '../actions';

export default async function RegisterPage() {
  if (await getSession()) redirect('/dashboard');
  return (
    <div>
      <h1>Cadastrar minha barbearia</h1>
      <ActionForm action={register}>
        <label className="field"><span>Nome da barbearia</span><input name="shop" required maxLength={80} /></label>
        <label className="field"><span>Seu nome</span><input name="name" autoComplete="name" required maxLength={80} /></label>
        <label className="field"><span>E-mail</span><input name="email" type="email" autoComplete="username" required /></label>
        <label className="field"><span>Senha</span><input name="password" type="password" autoComplete="new-password" required minLength={10} /><small>Pelo menos 10 caracteres.</small></label>
        <Submit>Criar conta</Submit>
      </ActionForm>
      <p className="muted">Já tem conta? <Link href="/login">Entrar</Link></p>
    </div>
  );
}
