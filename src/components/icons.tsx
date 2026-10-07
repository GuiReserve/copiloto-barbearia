const P: Record<string, string> = {
  inicio: 'M3 11l9-7 9 7v8a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z',
  agenda: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z',
  fila: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  clientes: 'M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 19v-1a4 4 0 00-3-3.9M15 3.1a3.5 3.5 0 010 6.8',
  financeiro: 'M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.7 4.5 3 4.5 1.300 4.5 3-2 3-4.5 3-4.5-1.300-4.5-3',
  marketing: 'M4 14h3l9 5V5L7 10H4zM19.500 9a4 4 0 010 6',
  metas: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8zM12 12h.01',
  relatorios: 'M5 20V10M12 20V4M19 20v-7',
  barbeiros: 'M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM8.500 7.500L21 19M8.500 16.500L21 5',
  servicos: 'M4 6h16M4 12h16M4 18h10',
  config: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.300l2-1.500-2-3.400-2.300 1a7 7 0 00-2.300-1.300L14 3h-4l-.3 2.500a7 7 0 00-2.300 1.300l-2.300-1-2 3.400 2 1.500a7 7 0 000 2.600l-2 1.500 2 3.400 2.300-1a7 7 0 002.300 1.300L10 21h4l.3-2.500a7 7 0 002.300-1.300l2.300 1 2-3.400-2-1.500A7 7 0 0019 12z',
  mais: 'M5 12h.01M12 12h.01M19 12h.01',
};
export function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? P.mais} />
    </svg>
  );
}
