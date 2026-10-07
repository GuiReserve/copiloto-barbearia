import { NextRequest, NextResponse } from 'next/server';

const PUBLIC = [/^\/login$/, /^\/cadastro$/, /^\/o\/[\w-]+$/, /^\/b\/[a-z0-9-]+$/];

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV === 'development';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-inline'" : ''}`,
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  const { pathname } = request.nextUrl;
  const cookie = request.cookies.get('__Host-sessao') ?? request.cookies.get('sessao');
  // Triagem rápida. A validação real da sessão acontece no servidor, em cada página e ação.
  if (!cookie && !PUBLIC.some((r) => r.test(pathname))) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  if (!PUBLIC.some((r) => r.test(pathname))) response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const config = {
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico|icon.svg).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }] }],
};
