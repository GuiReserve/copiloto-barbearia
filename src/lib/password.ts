import 'server-only';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt (N=2^16, r=8, p=2): parâmetros recomendados pela OWASP. Sem dependência nativa.
const N = 2 ** 16, R = 8, P = 2, LEN = 32;
const derive = (pw: string, salt: Buffer, n = N, r = R, p = P) =>
  new Promise<Buffer>((ok, fail) =>
    scrypt(pw.normalize('NFKC'), salt, LEN, { N: n, r, p, maxmem: 256 * 1024 * 1024 }, (e, k) => (e ? fail(e) : ok(k))));

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(pw, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string | undefined): Promise<boolean> {
  // sem usuário, calcula mesmo assim: o tempo de resposta não revela se o e-mail existe
  const parts = (stored ?? `scrypt$${N}$${R}$${P}$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(LEN).toString('base64')}`).split('$');
  const [, n, r, p, salt, hash] = parts;
  const key = await derive(pw, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  const expected = Buffer.from(hash, 'base64');
  return key.length === expected.length && timingSafeEqual(key, expected) && !!stored;
}
