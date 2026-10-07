import { requireSession } from '@/lib/auth';
import { NAV } from '@/lib/nav';
import { NavLink } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ROLES } from '@/lib/format';
import { logout } from '../(auth)/actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const items = NAV.filter((n) => n.roles.includes(s.role));
  const mobile = items.slice(0, 4);
  return (
    <div className="shell">
      <aside className="side">
        <p className="brand">{s.shopName}<small>Copiloto da Barbearia</small></p>
        <nav className="nav" aria-label="Principal">
          {items.map((n) => <NavLink key={n.href} href={n.href}><Icon name={n.icon} />{n.label}</NavLink>)}
        </nav>
        <div className="side-foot stack-sm">
          <p className="small"><strong>{s.name}</strong><br /><span className="muted">{ROLES[s.role]}</span></p>
          <form action={logout}><button className="btn btn-sm">Sair</button></form>
        </div>
      </aside>
      <main className="main">{children}</main>
      <nav className="bottomnav" aria-label="Principal">
        {mobile.map((n) => <NavLink key={n.href} href={n.href}><Icon name={n.icon} />{n.label.split(' ')[0]}</NavLink>)}
        <NavLink href="/mais"><Icon name="mais" />Mais</NavLink>
      </nav>
    </div>
  );
}
