// Aplica db/schema.sql com o usuário DONO do banco e define a senha do papel do app.
// Uso: DATABASE_URL_OWNER=... APP_DB_PASSWORD=... npm run db:migrate
import { readFileSync } from 'node:fs';
import pg from 'pg';

const url = process.env.DATABASE_URL_OWNER, pw = process.env.APP_DB_PASSWORD;
// No build da Vercel (--se-configurado) a migração só roda se as duas variáveis existirem; sem elas, segue direto.
if ((!url || !pw) && process.argv.includes('--se-configurado')) { console.log('Migração pulada: DATABASE_URL_OWNER/APP_DB_PASSWORD ausentes.'); process.exit(0); }
if (!url || !pw) { console.error('Defina DATABASE_URL_OWNER e APP_DB_PASSWORD.'); process.exit(1); }
if (pw.length < 24) { console.error('APP_DB_PASSWORD precisa de pelo menos 24 caracteres. Gere com: openssl rand -base64 32'); process.exit(1); }

const c = new pg.Client({ connectionString: url });
await c.connect();
await c.query(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
await c.query(`alter role barber_app password ${c.escapeLiteral(pw)}`);
console.log('Schema aplicado. Papel "barber_app" pronto: use-o na DATABASE_URL do app.');
await c.end();
