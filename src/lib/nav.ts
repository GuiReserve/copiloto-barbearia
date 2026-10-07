import type { Role } from './auth';

const A: Role[] = ['admin'], S: Role[] = ['admin', 'recepcao'], T: Role[] = ['admin', 'recepcao', 'barbeiro'];
export const NAV: { href: string; label: string; icon: string; roles: Role[] }[] = [
  { href: '/dashboard', label: 'Início', icon: 'inicio', roles: T },
  { href: '/agenda', label: 'Agenda', icon: 'agenda', roles: T },
  { href: '/fila', label: 'Fila de espera', icon: 'fila', roles: S },
  { href: '/clientes', label: 'Clientes', icon: 'clientes', roles: T },
  { href: '/financeiro', label: 'Financeiro', icon: 'financeiro', roles: A },
  { href: '/barbeiros', label: 'Barbeiros', icon: 'barbeiros', roles: A }, // rótulo e endereço mudam conforme o tipo de negócio (ver layout)
  { href: '/servicos', label: 'Serviços', icon: 'servicos', roles: A },
  { href: '/configuracoes', label: 'Configurações', icon: 'config', roles: T },
];

