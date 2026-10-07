import Link from 'next/link';
import { isKind } from '@/lib/terms';
import { ActionForm, PasswordInput, Submit } from '@/components/ui';
import { AuthShell } from '@/components/auth-shell';
import { recover } from '../actions';

export default async function RecoverPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams, kind = isKind(sp.tipo) ? sp.tipo : 'barbearia';
  return (
    <AuthShell kind={kind}>
      <div>
        <h1>Criar senha nova</h1>
        <p className="muted">Use o código de recuperação que você gerou em Configurações. Ele vale uma vez.</p>
        <ActionForm action={recover}>
          <label className="field"><span>E-mail</span><input name="email" type="email" autoComplete="username" autoCapitalize="none" required /></label>
          <label className="field"><span>Código de recuperação</span><input name="code" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" required /></label>
          <label className="field"><span>Senha nova</span><PasswordInput name="password" autoComplete="new-password" minLength={8} /></label>
          <label className="field"><span>Repita a senha nova</span><PasswordInput name="password2" autoComplete="new-password" minLength={8} /></label>
          <Submit>Salvar senha nova</Submit>
        </ActionForm>
        <p className="muted small">Sem o código? Peça para um admin {kind === 'sobrancelha' ? 'do estúdio' : 'da barbearia'} redefinir a sua senha em Configurações → Equipe. <Link href={kind === 'barbearia' ? '/login' : `/login?tipo=${kind}`}>Voltar</Link></p>
      </div>
    </AuthShell>
  );
}
