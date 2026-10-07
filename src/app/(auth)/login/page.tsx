import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { ActionForm, Submit } from '@/components/ui';
import { login } from '../actions';

export default async function LoginPage() {
  if (await getSession()) redirect('/dashboard');
  return (
    <div>
      <h1>Entrar</h1>
      <ActionForm action={login}>
        <label className="field"><span>E-mail</span><input name="email" type="email" autoComplete="username" required /></label>
        <label className="field"><span>Senha</span><input name="password" type="password" autoComplete="current-password" required /></label>
        <Submit>Entrar</Submit>
      </ActionForm>
      <p className="muted">Ainda não usa? <Link href="/cadastro">Cadastrar minha barbearia</Link></p>
    </div>
  );
}
