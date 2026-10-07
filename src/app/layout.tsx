import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/hanken-grotesk';
import '@fontsource-variable/fraunces';
import './globals.css';

export const metadata: Metadata = { title: 'Copiloto', description: 'Agenda, fila de espera, encaixes e financeiro do seu negócio em um só lugar.', robots: { index: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: [{ media: '(prefers-color-scheme: dark)', color: '#0c1322' }, { color: '#f2f4f8' }] };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers(); // renderização por requisição: cada resposta leva o seu nonce de CSP
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
