import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { isKind } from '@/lib/terms';
import { ActionForm, PasswordInput, Submit } from '@/components/ui';
import { AuthShell } from '@/components/auth-shell';
import { login } from '../actions';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  if (await getSession()) redirect('/dashboard');
  const sp = await searchParams, kind = isKind(sp.tipo) ? sp.tipo : 'barbearia', q = kind === 'barbearia' ? '' : `?tipo=${kind}`;
  return (
    <AuthShell kind={kind}>
      <div>
        <h1>Entrar</h1>
        {sp.senha === 'nova' && <p className="notice ok">Senha nova criada. Entre com ela.</p>}
        <ActionForm action={login}>
          <label className="field"><span>E-mail</span><input name="email" type="email" autoComplete="username" autoCapitalize="none" required /></label>
          <label className="field"><span>Senha</span><PasswordInput name="password" autoComplete="current-password" /></label>
          <Submit>Entrar</Submit>
        </ActionForm>
        <p className="muted"><Link href={`/recuperar${q}`}>Esqueci a senha</Link> · Ainda não usa? <Link href={`/cadastro${q}`}>Criar conta</Link></p>
      </div>
    </AuthShell>
  );
}
