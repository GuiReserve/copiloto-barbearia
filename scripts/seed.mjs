// Dados de DEMONSTRAÇÃO, separados do produto. Cria uma barbearia fictícia para você explorar o sistema.
// Uso: DATABASE_URL_OWNER=... npm run db:seed          (login: demo@exemplo.com / senha impressa no final)
// Nunca roda sozinho e não toca em barbearias existentes.
import { randomBytes, scryptSync } from 'node:crypto';
import pg from 'pg';

const url = process.env.DATABASE_URL_OWNER;
if (!url) { console.error('Defina DATABASE_URL_OWNER.'); process.exit(1); }
const hash = (pw) => { const salt = randomBytes(16); const N = 65536;
  return `scrypt$${N}$8$2$${salt.toString('base64')}$${scryptSync(pw.normalize('NFKC'), salt, 32, { N, r: 8, p: 2, maxmem: 256 * 1024 * 1024 }).toString('base64')}`; };
const email = process.env.SEED_EMAIL ?? 'demo@exemplo.com';
const password = process.env.SEED_PASSWORD ?? randomBytes(9).toString('base64url');
const rnd = (n) => Math.floor(Math.random() * n), pick = (a) => a[rnd(a.length)];

const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, p) => (await c.query(sql, p)).rows;
await c.query('begin');
const [{ id: user }] = await q(`select auth_register('Barbearia Demonstração', 'Dono Demo', $1, $2, 'seed') id`, [email, hash(password)]);
if (!user) { console.error('Já existe usuário com este e-mail. Nada foi alterado.'); await c.query('rollback'); process.exit(1); }
const [{ barbershop_id: shop }] = await q(`select barbershop_id from users where id = $1`, [user]);
const tz = 'America/Sao_Paulo';
await c.query(`set local time zone '${tz}'`);

const barbers = await q(`insert into barbers (barbershop_id, name, specialties, commission_pct, monthly_goal) values
  ($1, 'Rafael Lima', 'Degradê, navalhado', 40, 9000), ($1, 'Bruno Costa', 'Barba desenhada', 40, 8000) returning id`, [shop]);
const services = await q(`insert into services (barbershop_id, name, price, duration_min) values
  ($1, 'Corte', 40, 30), ($1, 'Corte + Barba', 70, 50), ($1, 'Barba', 35, 25) returning id, price, duration_min`, [shop]);
await q(`insert into barber_services (barbershop_id, barber_id, service_id) select $1, b.id, s.id from barbers b, services s where b.barbershop_id = $1 and s.barbershop_id = $1`, [shop]);
const sources = await q(`select id, name from marketing_sources where barbershop_id = $1`, [shop]);
const src = (n) => sources.find((s) => s.name === n).id;
const weighted = ['Instagram', 'Instagram', 'Instagram', 'Instagram', 'Google', 'Google', 'Google', 'Indicação', 'Indicação', 'Passou na frente'];

const names = ['João Pedro', 'Lucas Almeida', 'Mateus Rocha', 'Gabriel Souza', 'Thiago Martins', 'André Barros', 'Felipe Nunes', 'Caio Ribeiro', 'Diego Farias', 'Vinícius Prado',
  'Marcelo Dias', 'Henrique Lopes', 'Rodrigo Pires', 'Eduardo Melo', 'Gustavo Teles', 'Leandro Reis', 'Paulo Vieira', 'Igor Santana', 'Renan Moura', 'Samuel Castro',
  'Otávio Braga', 'Danilo Cunha', 'Fábio Guedes', 'Murilo Sales', 'Wesley Brito', 'Alex Tavares', 'Júlio Peixoto', 'Nícolas Rangel', 'Pedro Paiva', 'Vitor Leal'];
const clients = [];
for (const [i, name] of names.entries()) {
  const s = src(pick(weighted)), daysAgo = 5 + rnd(110);
  const [r] = await q(`insert into clients (barbershop_id, name, phone, source_id, created_at) values ($1, $2, $3, $4, now() - make_interval(days => $5)) returning id`,
    [shop, name, `(11) 9${String(80000000 + i * 31337).slice(0, 4)}-${String(1000 + i * 77).slice(0, 4)}`, s, daysAgo]);
  clients.push({ id: r.id, source: s, since: daysAgo });
}

// 60 dias de histórico + 5 dias à frente, respeitando o expediente (seg a sáb, 9h às 19h, almoço 12h às 13h)
let made = 0;
for (let d = -60; d <= 5; d++) {
  const [{ dow, dia: day }] = await q(`select extract(dow from current_date + $1::int)::int dow, (current_date + $1::int)::text dia`, [d]);
  if (dow === 0) continue;
  for (const b of barbers) {
    let t = 9 * 60;
    while (t < 19 * 60 - 30) {
      if (t >= 12 * 60 && t < 13 * 60) { t = 13 * 60; continue; }
      const sv = pick(services);
      const end = t + sv.duration_min;
      if ((t < 12 * 60 && end > 12 * 60) || end > 19 * 60) { t += 30; continue; }
      const busyChance = t >= 17 * 60 ? 0.85 : 0.55;
      const cl = pick(clients);
      if (Math.random() < busyChance && cl.since >= -d) {
        const roll = Math.random();
        const status = d < 0 ? (roll < 0.86 ? 'concluido' : roll < 0.94 ? 'cancelado' : 'faltou') : d === 0 && t < 11 * 60 ? 'concluido' : (roll < 0.6 ? 'confirmado' : 'agendado');
        try {
          await c.query('savepoint a');
          await q(`insert into appointments (barbershop_id, client_id, barber_id, service_id, source_id, starts_at, ends_at, status, price)
                   values ($1,$2,$3,$4,$5, ($6::date + make_interval(mins => $7))::timestamptz, ($6::date + make_interval(mins => $8))::timestamptz, $9, $10)`,
            [shop, cl.id, b.id, sv.id, cl.source, day, t, end, status, sv.price]);
          made++;
        } catch { await c.query('rollback to savepoint a'); }
      }
      t = Math.ceil(end / 30) * 30;
    }
  }
}

await q(`insert into fixed_costs (barbershop_id, category, name, amount, starts_on) values
  ($1, 'aluguel', 'Aluguel', 3000, date_trunc('month', current_date - 90)::date), ($1, 'internet', 'Internet', 120, date_trunc('month', current_date - 90)::date),
  ($1, 'sistemas', 'Maquininha', 89, date_trunc('month', current_date - 90)::date)`, [shop]);
await q(`insert into expenses (barbershop_id, category, description, amount, spent_on) values
  ($1, 'energia', 'Conta de luz', 380, current_date - 12), ($1, 'agua', 'Conta de água', 95, current_date - 10),
  ($1, 'produtos', 'Pomadas e lâminas', 420, current_date - 6), ($1, 'marketing', 'Impulsionamento', 150, current_date - 3)`, [shop]);
await q(`insert into revenues (barbershop_id, category, description, amount, received_on) values
  ($1, 'produtos', 'Pomada modeladora', 45, current_date - 4), ($1, 'produtos', 'Óleo para barba', 60, current_date - 1)`, [shop]);
// três pessoas na fila de hoje, fim de tarde
for (const i of [0, 1, 2]) await q(`insert into waiting_list (barbershop_id, client_id, service_id, desired_date, window_start, window_end, flex_minutes) values ($1,$2,$3,current_date,'16:00','19:00',30)`, [shop, clients[i].id, services[0].id]);
await c.query('commit');
console.log(`Demonstração criada: ${made} agendamentos.\n  login: ${email}\n  senha: ${password}`);
await c.end();
