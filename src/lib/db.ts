import 'server-only';
import { Pool, types, type PoolClient } from 'pg';
import type { Session } from './auth';

// date e timestamp chegam como texto: nada de conversão de fuso feita pelo driver
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1114, (v) => v);
types.setTypeParser(1184, (v) => v);
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

const g = globalThis as unknown as { __pool?: Pool };
function pool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada');
  return (g.__pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 8_000,
  }));
}

export type Row = Record<string, any>;
export type Tx = {
  q: <T = Row>(sql: string, params?: unknown[]) => Promise<T[]>;
  one: <T = Row>(sql: string, params?: unknown[]) => Promise<T | undefined>;
};
const wrap = (c: PoolClient): Tx => ({
  q: async (sql, params) => (await c.query(sql, params as any[])).rows,
  one: async (sql, params) => (await c.query(sql, params as any[])).rows[0],
});

/**
 * Toda leitura e escrita de dados de uma barbearia passa por aqui.
 * A transação carrega a identidade (barbearia, usuário, papel) e o Postgres aplica o RLS:
 * mesmo uma consulta sem WHERE não enxerga dados de outra barbearia.
 */
export async function withTenant<T>(s: Session, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query('begin');
    await c.query(
      `select set_config('app.barbershop_id', $1, true), set_config('app.user_id', $2, true),
              set_config('app.role', $3, true), set_config('app.barber_id', $4, true),
              set_config('TimeZone', $5, true)`,
      [s.shopId, s.userId, s.role, s.barberId ?? '', s.tz],
    );
    const out = await fn(wrap(c));
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Só para as funções auth_* e offer_public_* (SECURITY DEFINER). Sem contexto de barbearia, nenhuma tabela é legível. */
export async function sys<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await pool().query(sql, params as any[])).rows;
}
