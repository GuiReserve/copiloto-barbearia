import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { Icon } from '@/components/icons';
import { ROLES } from '@/lib/format';
import { NAV } from '@/lib/nav';
import { terms } from '@/lib/terms';
import { logout } from '../../(auth)/actions';

export default async function MorePage() {
  const s = await requireSession();
  return (
    <div className="stack">
      <div className="page-head"><div><h1>{s.shopName}</h1><p>{s.name}, {ROLES[s.role]}</p></div></div>
      <nav className="card nav">
        {NAV.filter((n) => n.roles.includes(s.role)).map((n) => (n.href === '/barbeiros' ? { ...n, href: terms(s.kind).proPath, label: terms(s.kind).Pros } : n)).map((n) => <Link key={n.href} href={n.href}><Icon name={n.icon} />{n.label}</Link>)}
      </nav>
      <form action={logout}><button className="btn">Sair</button></form>
    </div>
  );
}
