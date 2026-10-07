import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { isKind, KINDS, terms } from '@/lib/terms';
import { ActionForm, PasswordInput, Submit } from '@/components/ui';
import { AuthShell } from '@/components/auth-shell';
import { register } from '../actions';

export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  if (await getSession()) redirect('/dashboard');
  const sp = await searchParams, kind = isKind(sp.tipo) ? sp.tipo : 'barbearia', t = terms(kind);
  return (
    <AuthShell kind={kind}>
      <div>
        <h1>Cadastrar {t.minhaNegocio}</h1>
        <nav className="seg" aria-label="Tipo de negócio">
          {Object.entries(KINDS).map(([k, label]) => <Link key={k} href={`/cadastro?tipo=${k}`} aria-current={k === kind ? 'true' : undefined}>{label}</Link>)}
        </nav>
        <ActionForm action={register}>
          <input type="hidden" name="kind" value={kind} />
          <label className="field"><span>Nome {t.doNegocio}</span><input name="shop" required maxLength={80} /></label>
          <label className="field"><span>Seu nome</span><input name="name" autoComplete="name" required maxLength={80} /></label>
          <label className="field"><span>E-mail</span><input name="email" type="email" autoComplete="username" autoCapitalize="none" required /></label>
          <label className="field"><span>Senha</span><PasswordInput name="password" autoComplete="new-password" minLength={8} /><small>Pelo menos 8 caracteres.</small></label>
          <label className="field"><span>Repita a senha</span><PasswordInput name="password2" autoComplete="new-password" minLength={8} /></label>
          <Submit>Criar conta</Submit>
        </ActionForm>
        <p className="muted">Já tem conta? <Link href={kind === 'barbearia' ? '/login' : `/login?tipo=${kind}`}>Entrar</Link></p>
      </div>
    </AuthShell>
  );
}
