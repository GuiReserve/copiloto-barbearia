// Teste de segurança: prova, direto no banco e com o papel do app, que uma barbearia não alcança a outra
// e que cada perfil só faz o que pode. Use um banco de TESTE (cria e apaga duas barbearias fictícias).
// Uso: DATABASE_URL=...(barber_app) DATABASE_URL_OWNER=...(dono) npm run test:security
import pg from 'pg';
const app = new pg.Client({ connectionString: process.env.DATABASE_URL });
const owner = new pg.Client({ connectionString: process.env.DATABASE_URL_OWNER });
await app.connect(); await owner.connect();
let fail = 0;
const check = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FALHOU'} ${name}`); if (!ok) fail++; };
const as = async (ctx, fn) => { await app.query('begin');
  await app.query(`select set_config('app.barbershop_id',$1,true), set_config('app.user_id',$2,true), set_config('app.role',$3,true), set_config('app.barber_id',$4,true)`, [ctx.shop ?? '', ctx.user ?? '', ctx.role ?? '', ctx.barber ?? '']);
  try { return await fn(); } finally { await app.query('rollback'); } };
const rows = async (sql, p) => (await app.query(sql, p)).rows;
const denied = async (sql, p) => { await app.query('savepoint s'); try { const r = await app.query(sql, p); await app.query('rollback to s'); return r.rowCount === 0; } catch { await app.query('rollback to s'); return true; } };

const tag = `iso${Date.now()}`;
const mk = async (n) => { const [{ id: user }] = (await owner.query(`select auth_register($1,'Dono',$2,'x',$3) id`, [`Teste ${n}`, `${tag}${n}@teste.local`, tag + n])).rows;
  const shop = (await owner.query(`select barbershop_id from users where id=$1`, [user])).rows[0].barbershop_id;
  const q = async (s, p) => (await owner.query(s, p)).rows[0].id;
  const barber = await q(`insert into barbers (barbershop_id,name) values ($1,'B1') returning id`, [shop]);
  const barber2 = await q(`insert into barbers (barbershop_id,name) values ($1,'B2') returning id`, [shop]);
  const service = await q(`insert into services (barbershop_id,name,price,duration_min) values ($1,'Corte',40,30) returning id`, [shop]);
  const client = await q(`insert into clients (barbershop_id,name,phone) values ($1,'Cliente','11999990000') returning id`, [shop]);
  const client2 = await q(`insert into clients (barbershop_id,name) values ($1,'Outro') returning id`, [shop]);
  const appt = await q(`insert into appointments (barbershop_id,client_id,barber_id,service_id,starts_at,ends_at,price,status) values ($1,$2,$3,$4,now()+interval '1 day',now()+interval '1 day 30 min',40,'concluido') returning id`, [shop, client, barber, service]);
  await q(`insert into appointments (barbershop_id,client_id,barber_id,service_id,starts_at,ends_at,price) values ($1,$2,$3,$4,now()+interval '2 day',now()+interval '2 day 30 min',40) returning id`, [shop, client2, barber2, service]);
  await q(`insert into expenses (barbershop_id,category,amount,spent_on) values ($1,'aluguel',100,current_date) returning id`, [shop]);
  return { shop, user, barber, service, client, appt }; };
const A = await mk('a'), B = await mk('b');
const adminA = { shop: A.shop, user: A.user, role: 'admin' };

try {
  // 1. sem contexto, nada é visível
  await as({}, async () => {
    for (const t of ['clients', 'appointments', 'revenues', 'expenses', 'barbers', 'barbershops', 'audit_log', 'messages'])
      check(`sem sessão: ${t} vazio`, (await rows(`select count(*)::int n from ${t}`))[0].n === 0);
    check('sem sessão: não lê users.password_hash', await denied(`select password_hash from users`));
    check('sem sessão: não lê sessions', await denied(`select * from sessions`));
    check('sem sessão: não lê login_attempts', await denied(`select * from login_attempts`));
  });
  // 2. admin da barbearia A não alcança a B
  await as(adminA, async () => {
    check('A vê só os próprios clientes', (await rows(`select count(*)::int n from clients where barbershop_id <> $1`, [A.shop]))[0].n === 0 && (await rows(`select count(*)::int n from clients`))[0].n === 2);
    check('A não lê cliente de B pelo id', (await rows(`select 1 from clients where id=$1`, [B.client])).length === 0);
    check('A não altera cliente de B', await denied(`update clients set name='x' where id=$1`, [B.client]));
    check('A não apaga despesa de B', await denied(`delete from expenses where barbershop_id=$1`, [B.shop]));
    check('A não insere cliente em B', await denied(`insert into clients (barbershop_id,name) values ($1,'intruso')`, [B.shop]));
    check('A não agenda usando cliente de B (FK composta)', await denied(`insert into appointments (barbershop_id,client_id,barber_id,service_id,starts_at,ends_at,price) values ($1,$2,$3,$4,now()+interval '5 day',now()+interval '5 day 30 min',1)`, [A.shop, B.client, A.barber, A.service]));
    check('A não agenda usando barbeiro de B', await denied(`insert into appointments (barbershop_id,client_id,barber_id,service_id,starts_at,ends_at,price) values ($1,$2,$3,$4,now()+interval '5 day',now()+interval '5 day 30 min',1)`, [A.shop, A.client, B.barber, A.service]));
    check('A não move registro seu para B', await denied(`update clients set barbershop_id=$1 where id=$2`, [B.shop, A.client]));
    check('A não troca senha de usuário de B', (await rows(`select auth_set_password($1,'x',null) ok`, [B.user]))[0].ok === false);
    check('A não lê auditoria de B', (await rows(`select count(*)::int n from audit_log where barbershop_id=$1`, [B.shop]))[0].n === 0);
    check('auditoria não pode ser alterada', await denied(`update audit_log set action='x'`));
    check('auditoria não pode ser apagada', await denied(`delete from audit_log`));
    check('banco barra dois atendimentos no mesmo horário', await denied(`insert into appointments (barbershop_id,client_id,barber_id,service_id,starts_at,ends_at,price) select barbershop_id,client_id,barber_id,service_id,starts_at,ends_at,price from appointments where id=$1`, [A.appt]));
    check('receita do atendimento concluído foi gerada', (await rows(`select amount from revenues where appointment_id=$1`, [A.appt]))[0]?.amount === '40.00');
  });
  // 3. perfis
  await as({ ...adminA, role: 'recepcao' }, async () => {
    check('recepção não vê financeiro', (await rows(`select count(*)::int n from revenues`))[0].n === 0 && (await rows(`select count(*)::int n from expenses`))[0].n === 0);
    check('recepção não altera serviços', await denied(`update services set price=1`));
    check('recepção não cria usuário', await denied(`insert into users (barbershop_id,name,email,password_hash,role) values ($1,'x','x@x.co','h','admin')`, [A.shop]));
    check('recepção vê a agenda inteira', (await rows(`select count(*)::int n from appointments`))[0].n === 2);
  });
  await as({ ...adminA, role: 'barbeiro', barber: A.barber }, async () => {
    check('barbeiro vê só a própria agenda', (await rows(`select count(*)::int n from appointments`))[0].n === 1);
    check('barbeiro vê só os próprios clientes', (await rows(`select count(*)::int n from clients`))[0].n === 1);
    check('barbeiro não vê financeiro', (await rows(`select count(*)::int n from revenues`))[0].n === 0);
    check('barbeiro não muda o preço do atendimento', await denied(`update appointments set price=1 where id=$1`, [A.appt]));
    check('barbeiro não cria agendamento', await denied(`insert into appointments (barbershop_id,client_id,barber_id,service_id,starts_at,ends_at,price) values ($1,$2,$3,$4,now()+interval '9 day',now()+interval '9 day 30 min',1)`, [A.shop, A.client, A.barber, A.service]));
    check('barbeiro não vê fila nem mensagens', (await rows(`select count(*)::int n from waiting_list`))[0].n === 0 && (await rows(`select count(*)::int n from messages`))[0].n === 0);
  });
  // 4. o papel do app não tem poderes de dono
  await as(adminA, async () => {
    check('app não desliga o RLS', await denied(`alter table clients disable row level security`));
    check('app não apaga tabela', await denied(`drop table clients`));
    check('app não chama a função interna de encaixe', await denied(`select offer_accept_internal(gen_random_uuid())`));
  });
  const r = (await owner.query(`select rolsuper, rolbypassrls, rolcreaterole from pg_roles where rolname='barber_app'`)).rows[0];
  check('papel do app sem superuser, bypassrls ou createrole', !r.rolsuper && !r.rolbypassrls && !r.rolcreaterole);
} finally {
  await owner.query(`delete from barbershops where id = any($1)`, [[A.shop, B.shop]]);
  await owner.query(`delete from login_attempts where ip like $1`, [tag + '%']);
  await app.end(); await owner.end();
}
console.log(fail ? `\n${fail} verificação(ões) falharam.` : '\nIsolamento entre barbearias e perfis: tudo certo.');
process.exit(fail ? 1 : 0);
