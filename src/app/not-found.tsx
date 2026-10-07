import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="center-page">
      <div className="card"><h1>Página não encontrada</h1><p className="muted">O endereço pode ter mudado. Confira o link com quem enviou.</p><Link className="btn" href="/">Ir para o início</Link></div>
    </main>
  );
}
