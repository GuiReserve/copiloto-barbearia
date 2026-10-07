'use client';
import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { State } from '@/lib/action';

type Action = (prev: State, fd: FormData) => Promise<State>;

const Pending = createContext(false);

/**
 * Formulário ligado a uma ação do servidor: mostra o erro devolvido e fecha o diálogo quando dá certo.
 * O envio é feito à mão para o React não limpar os campos quando a ação devolve erro.
 */
export function ActionForm({ action, children, className = 'form', done }: { action: Action; children: ReactNode; className?: string; done?: string }) {
  const [state, dispatch, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) { ref.current?.reset(); ref.current?.closest('dialog')?.close(); }
  }, [state]);
  return (
    <form ref={ref} className={className} onSubmit={(e) => {
      e.preventDefault();
      if (pending) return;
      const fd = new FormData(e.currentTarget);
      startTransition(() => dispatch(fd));
    }}>
      <Pending.Provider value={pending}>{children}</Pending.Provider>
      {state?.error && <p role="alert" className="form-error">{state.error}</p>}
      {state?.ok && done && <p role="status" className="form-ok">{done}</p>}
    </form>
  );
}

export function Submit({ children, className = 'btn btn-primary' }: { children: ReactNode; className?: string }) {
  const pending = useContext(Pending);
  return <button type="submit" className={className} disabled={pending}>{children}</button>;
}

export function Modal({ label, title, children, className = 'btn', open = false }: { label: ReactNode; title: string; children: ReactNode; className?: string; open?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open && !ref.current?.open) ref.current?.showModal(); }, [open]);
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.showModal()}>{label}</button>
      <dialog ref={ref} className="modal" onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="x" aria-label="Fechar" onClick={() => ref.current?.close()}>×</button>
        </div>
        <div className="modal-body">{children}</div>
      </dialog>
    </>
  );
}

export function CopyButton({ text, label = 'Copiar mensagem' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn btn-sm" onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); }}>
      {done ? 'Copiado' : label}
    </button>
  );
}

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const path = usePathname();
  const active = path === href || path.startsWith(`${href}/`);
  return <Link href={href} aria-current={active ? 'page' : undefined}>{children}</Link>;
}

/** Envia o formulário de filtro assim que um campo muda. */
export function AutoSubmit({ children, className }: { children: ReactNode; className?: string }) {
  return <form className={className} onChange={(e) => (e.currentTarget as HTMLFormElement).requestSubmit()}>{children}</form>;
}
