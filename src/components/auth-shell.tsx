import type { ReactNode } from 'react';
import { terms, type Kind } from '@/lib/terms';

/** Moldura das telas de entrar, cadastrar e recuperar senha, na identidade do tipo de negócio. */
export function AuthShell({ kind, children }: { kind: Kind; children: ReactNode }) {
  const t = terms(kind);
  return (
    <div className="auth" data-kind={kind}>
      <section className="auth-art">
        <p className="brand">{t.produto}</p>
        <h1>Abra uma vez por dia e saiba como está a casa.</h1>
        <ul>{t.pitch.map((x) => <li key={x}>{x}</li>)}</ul>
      </section>
      <main className="auth-form">{children}</main>
    </div>
  );
}
