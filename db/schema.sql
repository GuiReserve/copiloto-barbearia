-- Copiloto da Barbearia — schema Postgres (Neon)
-- Rode com o usuário DONO do banco (neondb_owner). O app conecta com o papel
-- restrito "barber_app", que NÃO é dono das tabelas e fica sujeito ao RLS.
-- Idempotente: pode rodar de novo com segurança.

create extension if not exists btree_gist;

-- ───────────────────────── contexto da requisição ─────────────────────────
-- O servidor define estas variáveis no início de cada transação (SET LOCAL).
-- Sem elas, as funções devolvem NULL e nenhuma linha fica visível.
create or replace function app_shop() returns uuid language sql stable as
$$ select nullif(current_setting('app.barbershop_id', true), '')::uuid $$;
create or replace function app_user() returns uuid language sql stable as
$$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
create or replace function app_barber() returns uuid language sql stable as
$$ select nullif(current_setting('app.barber_id', true), '')::uuid $$;
create or replace function app_role() returns text language sql stable as
$$ select nullif(current_setting('app.role', true), '') $$;
create or replace function app_is_staff() returns boolean language sql stable as
$$ select app_role() in ('admin', 'recepcao') $$;

create or replace function touch_updated_at() returns trigger language plpgsql as
$$ begin new.updated_at = now(); return new; end $$;

-- ───────────────────────────────── tabelas ─────────────────────────────────
create table if not exists barbershops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists settings (
  barbershop_id uuid primary key references barbershops(id) on delete cascade,
  timezone text not null default 'America/Sao_Paulo',
  phone text,
  slot_minutes int not null default 30 check (slot_minutes between 5 and 120),
  offer_expiry_minutes int not null default 30 check (offer_expiry_minutes between 5 and 1440),
  auto_offer text not null default 'manual' check (auto_offer in ('manual', 'primeiro', 'todos')),
  inactive_days int not null default 45 check (inactive_days between 7 and 365),
  lost_days int not null default 90 check (lost_days between 14 and 730),
  vip_visits int not null default 10 check (vip_visits between 2 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists barbers (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references barbershops(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  photo_url text check (photo_url is null or photo_url ~ '^https://'),
  specialties text,
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  monthly_goal numeric(12,2) check (monthly_goal is null or monthly_goal >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id, id)
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references barbershops(id) on delete cascade,
  barber_id uuid,
  name text not null check (length(name) between 1 and 80),
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  password_hash text not null,
  role text not null check (role in ('admin', 'barbeiro', 'recepcao')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email),
  unique (barbershop_id, id),
  foreign key (barbershop_id, barber_id) references barbers(barbershop_id, id),
  check (role <> 'barbeiro' or barber_id is not null)
);

create table if not exists sessions (
  token_hash bytea primary key,
  user_id uuid not null references users(id) on delete cascade,
  ip text, user_agent text,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_user on sessions(user_id);

create table if not exists login_attempts (
  id bigint generated always as identity primary key,
  email text not null, ip text, success boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_email on login_attempts(email, created_at);
create index if not exists login_attempts_ip on login_attempts(ip, created_at);

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references barbershops(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  price numeric(10,2) not null check (price >= 0),
  duration_min int not null check (duration_min between 5 and 480),
  commission_pct numeric(5,2) check (commission_pct is null or commission_pct between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id, id)
);

create table if not exists barber_services (
  barbershop_id uuid not null references barbershops(id) on delete cascade,
  barber_id uuid not null,
  service_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (barber_id, service_id),
  foreign key (barbershop_id, barber_id) references barbers(barbershop_id, id) on delete cascade,
  foreign key (barbershop_id, service_id) references services(barbershop_id, id) on delete cascade
);

-- barber_id nulo = horário de funcionamento da barbearia; preenchido = horário individual
create table if not exists work_hours (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references barbershops(id) on delete cascade,
  barber_id uuid,
  weekday int not null check (weekday between 0 and 6),
  opens time not null, closes time not null,
  break_start time, break_end time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closes > opens),
  check ((break_start is null) = (break_end is null)),
  check (break_start is null or (break_start >= opens and break_end <= closes and break_end > break_start)),
  unique nulls not distinct (barbershop_id, barber_id, weekday),
  foreign key (barbershop_id, barber_id) references barbers(barbershop_id, id) on delete cascade
);

-- bloqueios, folgas e feriados (barber_id nulo = barbearia inteira)
create table if not exists time_blocks (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references barbershops(id) on delete cascade,
  barber_id uuid,
  kind text not null default 'bloqueio' check (kind in ('bloqueio', 'folga', 'feriado')),
  starts_at timestamptz not null, ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (barbershop_id, barber_id) references barbers(barbershop_id, id) on delete cascade
);
create index if not exists time_blocks_range on time_blocks(barbershop_id, starts_at);

create table if not exists marketing_sources (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references barbershops(id) on delete cascade,
  name text not null check (length(name) between 1 and 40),
  kind text not null default 'outro' check (kind in ('instagram', 'google', 'indicacao', 'outro')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id, id),
  unique (barbershop_id, name)
);

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references barbershops(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  phone text, email text, birth_date date, instagram text, notes text,
  preferred_barber_id uuid, preferred_service_id uuid, source_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id, id),
  foreign key (barbershop_id, preferred_barber_id) references barbers(barbershop_id, id),
  foreign key (barbershop_id, preferred_service_id) references services(barbershop_id, id),
  foreign key (barbershop_id, source_id) references marketing_sources(barbershop_id, id)
);
create index if not exists clients_shop_name on clients(barbershop_id, lower(name));

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references barbershops(id) on delete cascade,
  client_id uuid not null, barber_id uuid not null, service_id uuid not null, source_id uuid,
  starts_at timestamptz not null, ends_at timestamptz not null,
  status text not null default 'agendado' check (status in
    ('agendado', 'confirmado', 'em_atendimento', 'concluido', 'cancelado', 'faltou', 'encaixado')),
  price numeric(10,2) not null check (price >= 0),
  notes text, cancelled_at timestamptz, created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (barbershop_id, id),
  foreign key (barbershop_id, client_id) references clients(barbershop_id, id),
  foreign key (barbershop_id, barber_id) references barbers(barbershop_id, id),
  foreign key (barbershop_id, service_id) references services(barbershop_id, id),
  foreign key (barbershop_id, source_id) references marketing_sources(barbershop_id, id),
  -- o banco impede dois atendimentos ativos no mesmo barbeiro e horário
  constraint appointments_no_overlap exclude using gist
    (barber_id with =, tstzrange(starts_at, ends_at) with &&)
    where (status not in ('cancelado', 'faltou'))
);
create index if not exists appointments_shop_start on appointments(barbershop_id, starts_at);
create index if not exists appointments_client on appointments(client_id, starts_at);

create table if not exists waiting_list (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references barbershops(id) on delete cascade,
  client_id uuid not null, service_id uuid not null, barber_id uuid,
  desired_date date not null,
  window_start time not null, window_end time not null,
  flex_minutes int not null default 0 check (flex_minutes between 0 and 240),  -- tolerância fora da janela
  priority int not null default 0 check (priority between 0 and 9),
  notes text,
  status text not null default 'ativo' check (status in ('ativo', 'atendido', 'cancelado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (window_end > window_start),
  unique (barbershop_id, id),
  foreign key (barbershop_id, client_id) references clients(barbershop_id, id),
  foreign key (barbershop_id, service_id) references services(barbershop_id, id),
  foreign key (barbershop_id, barber_id) references barbers(barbershop_id, id)
);
create index if not exists waiting_list_lookup on waiting_list(barbershop_id, status, desired_date);

create table if not exists waiting_list_offers (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references barbershops(id) on delete cascade,
  waiting_id uuid not null, barber_id uuid not null,
  starts_at timestamptz not null, ends_at timestamptz not null,
  origin_appointment_id uuid, appointment_id uuid,
  status text not null default 'enviado' check (status in ('enviado', 'aceitou', 'recusou', 'expirou')),
  token_hash bytea not null unique,
  expires_at timestamptz not null, responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id, id),
  foreign key (barbershop_id, waiting_id) references waiting_list(barbershop_id, id) on delete cascade,
  foreign key (barbershop_id, barber_id) references barbers(barbershop_id, id),
  foreign key (barbershop_id, origin_appointment_id) references appointments(barbershop_id, id),
  foreign key (barbershop_id, appointment_id) references appointments(barbershop_id, id)
);
create index if not exists offers_slot on waiting_list_offers(barbershop_id, barber_id, starts_at);

create table if not exists message_templates (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references barbershops(id) on delete cascade,
  kind text not null check (kind in ('confirmacao', 'lembrete', 'cancelamento', 'encaixe', 'inativo')),
  body text not null check (length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id, kind)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references barbershops(id) on delete cascade,
  client_id uuid not null,
  kind text not null, channel text not null default 'manual',
  body text not null,
  status text not null default 'gerada' check (status in ('gerada', 'enviada', 'falhou')),
  appointment_id uuid, offer_id uuid, created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (barbershop_id, client_id) references clients(barbershop_id, id) on delete cascade,
  foreign key (barbershop_id, appointment_id) references appointments(barbershop_id, id),
  foreign key (barbershop_id, offer_id) references waiting_list_offers(barbershop_id, id) on delete cascade
);
create index if not exists messages_shop on messages(barbershop_id, created_at desc);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references barbershops(id) on delete cascade,
  category text not null check (category in ('aluguel', 'agua', 'energia', 'internet', 'salarios',
    'comissao', 'produtos', 'marketing', 'sistemas', 'outros')),
  description text,
  amount numeric(12,2) not null check (amount > 0),
  spent_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expenses_shop on expenses(barbershop_id, spent_on);

create table if not exists fixed_costs (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references barbershops(id) on delete cascade,
  category text not null check (category in ('aluguel', 'agua', 'energia', 'internet', 'salarios',
    'comissao', 'produtos', 'marketing', 'sistemas', 'outros')),
  name text not null check (length(name) between 1 and 80),
  amount numeric(12,2) not null check (amount > 0),  -- valor mensal
  starts_on date not null default current_date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists revenues (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references barbershops(id) on delete cascade,
  category text not null check (category in ('atendimento', 'produtos', 'outros')),
  description text,
  amount numeric(12,2) not null check (amount >= 0),
  received_on date not null,
  appointment_id uuid unique, barber_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (barbershop_id, appointment_id) references appointments(barbershop_id, id) on delete cascade,
  foreign key (barbershop_id, barber_id) references barbers(barbershop_id, id)
);
create index if not exists revenues_shop on revenues(barbershop_id, received_on);

create table if not exists marketing_metrics (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references barbershops(id) on delete cascade,
  source_id uuid not null,
  metric_date date not null,
  views int not null default 0 check (views >= 0),
  interactions int not null default 0 check (interactions >= 0),
  clicks int not null default 0 check (clicks >= 0),
  leads int not null default 0 check (leads >= 0),
  followers int check (followers is null or followers >= 0),  -- total no dia
  calls int not null default 0 check (calls >= 0),
  route_requests int not null default 0 check (route_requests >= 0),
  site_visits int not null default 0 check (site_visits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id, source_id, metric_date),
  foreign key (barbershop_id, source_id) references marketing_sources(barbershop_id, id) on delete cascade
);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references barbershops(id) on delete cascade,
  metric text not null check (metric in ('faturamento', 'clientes', 'novos_clientes', 'ticket_medio',
    'ocupacao', 'seguidores', 'agendamentos', 'receita_hora')),
  target numeric(12,2) not null check (target > 0),
  month date not null check (extract(day from month) = 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id, metric, month)
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references barbershops(id) on delete cascade,
  title text not null, body text, link text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notifications_shop on notifications(barbershop_id, created_at desc);

-- trilha de auditoria: o app só consegue inserir e ler, nunca alterar ou apagar
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  barbershop_id uuid not null references barbershops(id) on delete cascade,
  user_id uuid, action text not null, entity text, entity_id text,
  detail jsonb, ip text,
  created_at timestamptz not null default now()
);
create index if not exists audit_shop on audit_log(barbershop_id, created_at desc);

-- agendamento online: endereço público da barbearia e regras
alter table barbershops add column if not exists slug text;
alter table barbershops add column if not exists kind text not null default 'barbearia';  -- barbearia | sobrancelha
alter table users add column if not exists recovery_hash bytea;  -- sha256 do código de recuperação (uso único)
create unique index if not exists barbershops_slug on barbershops(slug);
alter table settings add column if not exists public_booking boolean not null default true;
alter table settings add column if not exists booking_days int not null default 14;

create or replace function make_slug(p text) returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(translate(p,
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')), '[^a-z0-9]+', '-', 'g'))
$$;
update barbershops set slug = left(coalesce(nullif(make_slug(name), ''), 'barbearia'), 30) || '-' || substr(md5(id::text), 1, 4) where slug is null;

do $$ declare t text; begin
  foreach t in array array['barbershops','settings','barbers','users','services','work_hours','time_blocks',
    'marketing_sources','clients','appointments','waiting_list','waiting_list_offers','message_templates',
    'messages','expenses','fixed_costs','revenues','marketing_metrics','goals','notifications'] loop
    execute format('drop trigger if exists touch on %I', t);
    execute format('create trigger touch before update on %I for each row execute function touch_updated_at()', t);
  end loop;
end $$;

-- ─────────────────── receita gerada pelo atendimento concluído ───────────────────
create or replace function trg_appointment_revenue() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare tz text;
begin
  if new.status = 'concluido' then
    select timezone into tz from settings where barbershop_id = new.barbershop_id;
    insert into revenues (barbershop_id, category, amount, received_on, appointment_id, barber_id)
    values (new.barbershop_id, 'atendimento', new.price,
            (new.starts_at at time zone coalesce(tz, 'America/Sao_Paulo'))::date, new.id, new.barber_id)
    on conflict (appointment_id) do update
      set amount = excluded.amount, received_on = excluded.received_on, barber_id = excluded.barber_id;
  else
    delete from revenues where appointment_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists appointment_revenue on appointments;
create trigger appointment_revenue after insert or update of status, price, starts_at, barber_id
  on appointments for each row execute function trg_appointment_revenue();

-- barbeiro só altera o andamento do próprio atendimento, nunca preço, cliente ou horário
create or replace function trg_appointment_barber_guard() returns trigger language plpgsql as $$
begin
  if app_role() = 'barbeiro' and (new.price, new.client_id, new.barber_id, new.service_id, new.starts_at, new.ends_at)
     is distinct from (old.price, old.client_id, old.barber_id, old.service_id, old.starts_at, old.ends_at) then
    raise exception 'barbeiro não pode alterar esses campos' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists appointment_barber_guard on appointments;
create trigger appointment_barber_guard before update on appointments
  for each row execute function trg_appointment_barber_guard();

-- ───────────────────────────── papel do aplicativo ─────────────────────────────
do $$ begin
  if not exists (select from pg_roles where rolname = 'barber_app') then
    create role barber_app login nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end $$;
revoke all on all tables in schema public from barber_app, public;
revoke all on all functions in schema public from public;
grant usage on schema public to barber_app;

grant select, insert, update, delete on
  barbers, services, barber_services, work_hours, time_blocks, marketing_sources, clients,
  waiting_list, waiting_list_offers, message_templates, messages, expenses, fixed_costs, revenues,
  marketing_metrics, goals, notifications to barber_app;
grant select, insert, update on appointments, settings to barber_app;
grant select, update (name, slug) on barbershops to barber_app;
grant select, insert on audit_log to barber_app;
-- senha: o app insere, mas nunca lê nem altera direto (só pelas funções auth_*)
grant select (id, barbershop_id, barber_id, name, email, role, active, created_at, updated_at) on users to barber_app;
grant insert (barbershop_id, barber_id, name, email, password_hash, role) on users to barber_app;
grant update (name, role, barber_id, active) on users to barber_app;
-- sessions e login_attempts: nenhum acesso direto

grant execute on function app_shop(), app_user(), app_barber(), app_role(), app_is_staff() to barber_app;

-- ───────────────────────────── row-level security ─────────────────────────────
do $$ declare t text; p record; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on %I', p.policyname, t);
    end loop;
  end loop;

  -- configuração: todos da barbearia leem, só admin altera
  foreach t in array array['barbers','services','barber_services','work_hours','settings','message_templates','marketing_sources'] loop
    execute format('create policy ler on %I for select using (barbershop_id = app_shop())', t);
    execute format($f$create policy gravar on %I for all using (barbershop_id = app_shop() and app_role() = 'admin')
      with check (barbershop_id = app_shop() and app_role() = 'admin')$f$, t);
  end loop;

  -- operação: admin e recepção
  foreach t in array array['waiting_list','waiting_list_offers','messages','notifications'] loop
    execute format('create policy operar on %I for all using (barbershop_id = app_shop() and app_is_staff())
      with check (barbershop_id = app_shop() and app_is_staff())', t);
  end loop;

  -- financeiro, marketing e metas: só admin
  foreach t in array array['expenses','fixed_costs','revenues','marketing_metrics','goals'] loop
    execute format($f$create policy admin on %I for all using (barbershop_id = app_shop() and app_role() = 'admin')
      with check (barbershop_id = app_shop() and app_role() = 'admin')$f$, t);
  end loop;
end $$;

create policy ler on time_blocks for select using (barbershop_id = app_shop());
create policy gravar on time_blocks for all using (barbershop_id = app_shop() and app_is_staff())
  with check (barbershop_id = app_shop() and app_is_staff());

create policy ler on barbershops for select using (id = app_shop());
create policy gravar on barbershops for update using (id = app_shop() and app_role() = 'admin')
  with check (id = app_shop() and app_role() = 'admin');

create policy ler on users for select using
  (barbershop_id = app_shop() and (app_role() = 'admin' or id = app_user()));
create policy criar on users for insert with check (barbershop_id = app_shop() and app_role() = 'admin');
create policy alterar on users for update using (barbershop_id = app_shop() and app_role() = 'admin')
  with check (barbershop_id = app_shop() and app_role() = 'admin');

-- agenda: barbeiro enxerga e atualiza apenas os próprios atendimentos
create policy ler on appointments for select using
  (barbershop_id = app_shop() and (app_is_staff() or barber_id = app_barber()));
create policy criar on appointments for insert with check (barbershop_id = app_shop() and app_is_staff());
create policy alterar on appointments for update using
  (barbershop_id = app_shop() and (app_is_staff() or barber_id = app_barber()))
  with check (barbershop_id = app_shop() and (app_is_staff() or barber_id = app_barber()));

-- clientes: barbeiro só vê quem ele atende
create policy ler on clients for select using (barbershop_id = app_shop() and (app_is_staff()
  or preferred_barber_id = app_barber()
  or exists (select from appointments a where a.client_id = clients.id and a.barber_id = app_barber())));
create policy gravar on clients for all using (barbershop_id = app_shop() and app_is_staff())
  with check (barbershop_id = app_shop() and app_is_staff());

create policy inserir on audit_log for insert with check (barbershop_id = app_shop());
create policy ler on audit_log for select using (barbershop_id = app_shop() and app_role() = 'admin');

-- ───────────────────────── autenticação (SECURITY DEFINER) ─────────────────────────
-- Único caminho até senhas, sessões e tentativas de login.

create or replace function auth_login_allowed(p_email text, p_ip text) returns boolean
language sql security definer set search_path = public, pg_temp as $$
  select (select count(*) from login_attempts where email = lower(p_email) and not success
            and created_at > now() - interval '15 minutes') < 5
     and (select count(*) from login_attempts where ip = p_ip and not success
            and created_at > now() - interval '15 minutes') < 30
$$;

create or replace function auth_login_record(p_email text, p_ip text, p_success boolean) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into login_attempts (email, ip, success) values (lower(left(p_email, 200)), p_ip, p_success);
  -- entrou com a senha certa: zera as tentativas erradas daquele e-mail
  delete from login_attempts where p_success and email = lower(p_email) and not success;
  delete from login_attempts where created_at < now() - interval '7 days';
$$;

create or replace function auth_user_for_login(p_email text)
returns table (user_id uuid, password_hash text) language sql security definer set search_path = public, pg_temp as $$
  select id, password_hash from users where email = lower(p_email) and active
$$;

create or replace function auth_session_create(p_user uuid, p_token_hash bytea, p_ip text, p_ua text) returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from sessions where expires_at < now();
  insert into sessions (token_hash, user_id, ip, user_agent, expires_at)
  values (p_token_hash, p_user, p_ip, left(p_ua, 300), now() + interval '7 days');
$$;

drop function if exists auth_session_get(bytea);
create or replace function auth_session_get(p_token_hash bytea)
returns table (user_id uuid, barbershop_id uuid, role text, barber_id uuid, user_name text, shop_name text, timezone text, kind text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update sessions set last_seen = now()
    where token_hash = p_token_hash and expires_at > now() and last_seen < now() - interval '5 minutes';
  return query
    select u.id, u.barbershop_id, u.role, u.barber_id, u.name, b.name, st.timezone, b.kind
    from sessions s join users u on u.id = s.user_id and u.active
    join barbershops b on b.id = u.barbershop_id
    join settings st on st.barbershop_id = b.id
    where s.token_hash = p_token_hash and s.expires_at > now();
end $$;

create or replace function auth_session_delete(p_token_hash bytea) returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from sessions where token_hash = p_token_hash
$$;

create or replace function auth_register(p_shop text, p_name text, p_email text, p_hash text, p_ip text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shop uuid; v_user uuid; d int;
begin
  if (select count(*) from login_attempts where email = '#cadastro' and ip = p_ip
        and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'muitas tentativas' using errcode = 'P0001';
  end if;
  insert into login_attempts (email, ip, success) values ('#cadastro', p_ip, true);
  if exists (select from users where email = lower(p_email)) then return null; end if;

  insert into barbershops (name) values (p_shop) returning id into v_shop;
  update barbershops set slug = left(coalesce(nullif(make_slug(p_shop), ''), 'barbearia'), 30) || '-' || substr(md5(v_shop::text), 1, 4) where id = v_shop;
  insert into settings (barbershop_id) values (v_shop);
  insert into users (barbershop_id, name, email, password_hash, role)
    values (v_shop, p_name, lower(p_email), p_hash, 'admin') returning id into v_user;
  for d in 1..6 loop  -- segunda a sábado
    insert into work_hours (barbershop_id, weekday, opens, closes, break_start, break_end)
    values (v_shop, d, '09:00', '19:00', '12:00', '13:00');
  end loop;
  insert into marketing_sources (barbershop_id, name, kind) values
    (v_shop, 'Instagram', 'instagram'), (v_shop, 'Google', 'google'), (v_shop, 'Indicação', 'indicacao'),
    (v_shop, 'Passou na frente', 'outro'), (v_shop, 'WhatsApp', 'outro'), (v_shop, 'Site', 'outro'),
    (v_shop, 'Outro', 'outro');
  insert into message_templates (barbershop_id, kind, body) values
    (v_shop, 'confirmacao', 'Olá, {{cliente}}! Seu horário na {{barbearia}} está confirmado para {{data}} às {{horario}}.'),
    (v_shop, 'lembrete', 'Fala, {{cliente}}! Passando para lembrar do seu horário hoje às {{horario}}. Te esperamos!'),
    (v_shop, 'cancelamento', 'Olá, {{cliente}}! Seu horário das {{horario}} foi liberado. Caso queira reagendar, podemos encontrar outro horário para você.'),
    (v_shop, 'encaixe', '🔥 Abriu um horário {{data}} às {{horario}} com {{barbeiro}}. Você está na nossa fila de espera. Quer aproveitar? Responda por aqui: {{link}}'),
    (v_shop, 'inativo', 'Fala, {{cliente}}! Faz um tempinho que não aparece por aqui. Que tal marcar seu próximo corte?');
  insert into audit_log (barbershop_id, user_id, action, ip) values (v_shop, v_user, 'barbearia.criada', p_ip);
  return v_user;
end $$;

-- cadastro com tipo de negócio: mesmas regras do auth_register, com mensagens no tom do estúdio
create or replace function auth_register_v2(p_shop text, p_name text, p_email text, p_hash text, p_ip text, p_kind text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid; v_shop uuid;
begin
  if p_kind not in ('barbearia', 'sobrancelha') then raise exception 'tipo inválido' using errcode = 'P0001'; end if;
  v_user := auth_register(p_shop, p_name, p_email, p_hash, p_ip);
  if v_user is null or p_kind = 'barbearia' then return v_user; end if;
  select barbershop_id into v_shop from users where id = v_user;
  update barbershops set kind = p_kind where id = v_shop;
  update message_templates t set body = x.body from (values
    ('confirmacao', 'Oi, {{cliente}}! Seu horário no {{estudio}} está confirmado para {{data}} às {{horario}}.'),
    ('lembrete', 'Oi, {{cliente}}! Passando para lembrar do seu horário hoje às {{horario}}. Venha sem maquiagem na região das sobrancelhas. Te esperamos!'),
    ('cancelamento', 'Oi, {{cliente}}! Seu horário das {{horario}} foi liberado. Se quiser reagendar, encontramos outro horário para você.'),
    ('encaixe', 'Oi, {{cliente}}! Abriu um horário {{data}} às {{horario}} com {{profissional}}. Você está na nossa fila de espera. Quer aproveitar? Responda por aqui: {{link}}'),
    ('inativo', 'Oi, {{cliente}}! Já faz um tempinho desde o seu último design. Que tal agendar a manutenção das sobrancelhas?')
  ) x(kind, body) where t.barbershop_id = v_shop and t.kind = x.kind;
  return v_user;
end $$;

-- código de recuperação: o dono gera em Configurações e guarda; vale uma vez
create or replace function auth_set_recovery(p_code_hash bytea) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update users set recovery_hash = p_code_hash where id = app_user() and barbershop_id = app_shop();
  return found;
end $$;

create or replace function auth_has_recovery() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select recovery_hash is not null from users where id = app_user() and barbershop_id = app_shop()
$$;

create or replace function auth_recover(p_email text, p_code_hash bytea, p_new_hash text, p_ip text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  select id into v_user from users where email = lower(p_email) and active and recovery_hash = p_code_hash;
  if v_user is null then
    insert into login_attempts (email, ip, success) values (lower(left(p_email, 200)), p_ip, false);
    return false;
  end if;
  update users set password_hash = p_new_hash, recovery_hash = null where id = v_user;
  delete from sessions where user_id = v_user;
  delete from login_attempts where email = lower(p_email) and not success;
  insert into audit_log (barbershop_id, user_id, action, ip) select barbershop_id, id, 'usuario.senha_recuperada_por_codigo', p_ip from users where id = v_user;
  return true;
end $$;

-- hash da senha do próprio usuário logado (para conferir a senha atual)
create or replace function auth_own_hash() returns text
language sql security definer set search_path = public, pg_temp as $$
  select password_hash from users where id = app_user() and barbershop_id = app_shop()
$$;

-- troca de senha: a própria, ou admin redefinindo alguém da mesma barbearia. Derruba as sessões.
create or replace function auth_set_password(p_user uuid, p_hash text, p_keep bytea) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app_shop() is null or not (p_user = app_user() or app_role() = 'admin') then return false; end if;
  update users set password_hash = p_hash where id = p_user and barbershop_id = app_shop();
  if not found then return false; end if;
  delete from sessions where user_id = p_user and (p_keep is null or token_hash <> p_keep);
  return true;
end $$;

-- desativar usuário encerra as sessões dele na hora
create or replace function trg_user_deactivated() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not new.active or new.role is distinct from old.role then delete from sessions where user_id = new.id; end if;
  return new;
end $$;
drop trigger if exists user_deactivated on users;
create trigger user_deactivated after update of active, role on users
  for each row execute function trg_user_deactivated();

-- ───────────────────────────── encaixe pela fila ─────────────────────────────
create or replace function offer_accept_internal(p_offer uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare o waiting_list_offers; w waiting_list; s services; v_appt uuid; v_source uuid;
begin
  select * into o from waiting_list_offers where id = p_offer for update;
  if o.status <> 'enviado' or o.expires_at < now() then
    raise exception 'Este convite não está mais disponível.' using errcode = 'P0001';
  end if;
  select * into w from waiting_list where id = o.waiting_id;
  select * into s from services where id = w.service_id;
  select source_id into v_source from clients where id = w.client_id;
  begin
    insert into appointments (barbershop_id, client_id, barber_id, service_id, source_id, starts_at, ends_at, status, price, notes)
    values (o.barbershop_id, w.client_id, o.barber_id, w.service_id, v_source, o.starts_at,
            o.starts_at + make_interval(mins => s.duration_min), 'encaixado', s.price, 'Encaixe pela fila de espera')
    returning id into v_appt;
  exception when exclusion_violation then
    update waiting_list_offers set status = 'expirou', responded_at = now() where id = o.id;
    return null;  -- alguém pegou o horário antes
  end;
  update waiting_list_offers set status = 'aceitou', responded_at = now(), appointment_id = v_appt where id = o.id;
  update waiting_list_offers set status = 'expirou', responded_at = now()
    where barbershop_id = o.barbershop_id and barber_id = o.barber_id and status = 'enviado' and id <> o.id
      and tstzrange(starts_at, ends_at) && tstzrange(o.starts_at, o.ends_at);
  update waiting_list set status = 'atendido' where id = w.id;
  return v_appt;
end $$;

create or replace function offer_accept(p_offer uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app_is_staff() or not exists
     (select from waiting_list_offers where id = p_offer and barbershop_id = app_shop()) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return offer_accept_internal(p_offer);
end $$;

-- página pública do convite: o cliente só precisa do link (token aleatório de 256 bits, buscado pelo hash)
create or replace function offer_public_get(p_token_hash bytea)
returns table (status text, expired boolean, shop_name text, client_name text, barber_name text,
               service_name text, price numeric, day text, hour text)
language sql security definer set search_path = public, pg_temp as $$
  select o.status, o.expires_at < now(), b.name, split_part(c.name, ' ', 1), br.name, s.name, s.price,
         to_char(o.starts_at at time zone st.timezone, 'DD/MM'), to_char(o.starts_at at time zone st.timezone, 'HH24:MI')
  from waiting_list_offers o
  join waiting_list w on w.id = o.waiting_id
  join clients c on c.id = w.client_id
  join services s on s.id = w.service_id
  join barbers br on br.id = o.barber_id
  join barbershops b on b.id = o.barbershop_id
  join settings st on st.barbershop_id = o.barbershop_id
  where o.token_hash = p_token_hash
$$;

create or replace function offer_public_respond(p_token_hash bytea, p_accept boolean) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare o waiting_list_offers; v_appt uuid; v_name text;
begin
  select * into o from waiting_list_offers where token_hash = p_token_hash for update;
  if not found then return 'invalido'; end if;
  if o.status <> 'enviado' then return o.status; end if;
  if o.expires_at < now() then
    update waiting_list_offers set status = 'expirou' where id = o.id; return 'expirou';
  end if;
  select c.name into v_name from waiting_list w join clients c on c.id = w.client_id where w.id = o.waiting_id;
  if p_accept then
    v_appt := offer_accept_internal(o.id);
    if v_appt is null then return 'expirou'; end if;
    insert into notifications (barbershop_id, title, body, link)
      values (o.barbershop_id, v_name || ' aceitou o encaixe', 'O horário foi preenchido automaticamente.', '/agenda');
    insert into audit_log (barbershop_id, action, entity, entity_id) values (o.barbershop_id, 'encaixe.aceito_pelo_cliente', 'offer', o.id::text);
    return 'aceitou';
  end if;
  update waiting_list_offers set status = 'recusou', responded_at = now() where id = o.id;
  insert into notifications (barbershop_id, title, body, link)
    values (o.barbershop_id, v_name || ' recusou o encaixe', 'O horário continua livre. Ofereça para o próximo da fila.', '/fila');
  return 'recusou';
end $$;

-- ───────────────────── agendamento online (página pública) ─────────────────────
-- Horários ocupados do dia, sem nenhum dado de cliente. Usado para calcular os horários livres.
create or replace function day_busy(p_date date) returns table (barber_id uuid, a int, len int)
language sql stable security definer set search_path = public, pg_temp as $$
  select ap.barber_id,
         (extract(hour from ap.starts_at at time zone st.timezone) * 60 + extract(minute from ap.starts_at at time zone st.timezone))::int,
         (extract(epoch from ap.ends_at - ap.starts_at) / 60)::int
  from appointments ap join settings st on st.barbershop_id = ap.barbershop_id
  where ap.barbershop_id = app_shop() and ap.status not in ('cancelado', 'faltou')
    and ap.starts_at >= (p_date::timestamp at time zone st.timezone)
    and ap.starts_at < ((p_date + 1)::timestamp at time zone st.timezone)
$$;

drop function if exists public_shop(text);
create or replace function public_shop(p_slug text)
returns table (id uuid, name text, phone text, timezone text, public_booking boolean, booking_days int, slot_minutes int, kind text)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.id, b.name, st.phone, st.timezone, st.public_booking, st.booking_days, st.slot_minutes, b.kind
  from barbershops b join settings st on st.barbershop_id = b.id where b.slug = p_slug
$$;

-- acha o cliente pelo telefone (só dígitos) ou cria um novo com origem "Site"
create or replace function public_client(p_shop uuid, p_name text, p_phone text, p_barber uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_client uuid; v_digits text := regexp_replace(p_phone, '\D', '', 'g');
begin
  select id into v_client from clients where barbershop_id = p_shop
    and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_digits order by created_at limit 1;
  if v_client is null then
    insert into clients (barbershop_id, name, phone, preferred_barber_id, source_id)
    values (p_shop, p_name, p_phone, p_barber,
            (select id from marketing_sources where barbershop_id = p_shop and name = 'Site' and active limit 1))
    returning id into v_client;
  end if;
  return v_client;
end $$;

-- limite por conexão: no máximo 6 pedidos por hora vindos do mesmo IP
create or replace function public_rate_ok(p_ip text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select count(*) from login_attempts where email = '#agendar' and ip = p_ip and created_at > now() - interval '1 hour') >= 6 then
    return false;
  end if;
  insert into login_attempts (email, ip, success) values ('#agendar', p_ip, true);
  return true;
end $$;

-- resultado: ok | invalido | limite | muitos | ocupado
create or replace function public_book(p_shop uuid, p_service uuid, p_barber uuid, p_date date, p_time time,
                                       p_name text, p_phone text, p_ip text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare st settings; sv services; v_client uuid; v_start timestamptz; v_appt uuid;
begin
  select * into st from settings where barbershop_id = p_shop;
  if not found or not st.public_booking then return 'invalido'; end if;
  if not public_rate_ok(p_ip) then return 'limite'; end if;
  select * into sv from services where id = p_service and barbershop_id = p_shop and active;
  if not found or not exists (select from barber_services bs join barbers b on b.id = bs.barber_id
       where bs.barber_id = p_barber and bs.service_id = p_service and b.active and b.barbershop_id = p_shop) then
    return 'invalido';
  end if;
  v_start := (p_date + p_time) at time zone st.timezone;
  if v_start < now() or p_date > (now() at time zone st.timezone)::date + st.booking_days then return 'invalido'; end if;
  v_client := public_client(p_shop, p_name, p_phone, p_barber);
  if (select count(*) from appointments where client_id = v_client and starts_at > now()
        and status in ('agendado', 'confirmado', 'encaixado')) >= 2 then
    return 'muitos';
  end if;
  begin
    insert into appointments (barbershop_id, client_id, barber_id, service_id, source_id, starts_at, ends_at, price, notes)
    values (p_shop, v_client, p_barber, p_service, (select source_id from clients where id = v_client), v_start,
            v_start + make_interval(mins => sv.duration_min), sv.price, 'Agendado pelo site')
    returning id into v_appt;
  exception when exclusion_violation then return 'ocupado';
  end;
  insert into notifications (barbershop_id, title, body, link)
    values (p_shop, 'Novo agendamento pelo site', p_name || ', ' || to_char(v_start at time zone st.timezone, 'DD/MM "às" HH24:MI') || ' (' || sv.name || ')', '/agenda?d=' || p_date);
  insert into audit_log (barbershop_id, action, entity, entity_id, ip) values (p_shop, 'agendamento.pelo_site', 'appointment', v_appt::text, p_ip);
  return 'ok';
end $$;

-- resultado: ok | invalido | limite
create or replace function public_wait(p_shop uuid, p_service uuid, p_barber uuid, p_date date, p_from time, p_to time,
                                       p_name text, p_phone text, p_ip text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare st settings; v_client uuid;
begin
  select * into st from settings where barbershop_id = p_shop;
  if not found or not st.public_booking or p_to <= p_from
     or p_date < (now() at time zone st.timezone)::date or p_date > (now() at time zone st.timezone)::date + st.booking_days
     or not exists (select from services where id = p_service and barbershop_id = p_shop and active)
     or (p_barber is not null and not exists (select from barbers where id = p_barber and barbershop_id = p_shop and active)) then
    return 'invalido';
  end if;
  if not public_rate_ok(p_ip) then return 'limite'; end if;
  v_client := public_client(p_shop, p_name, p_phone, p_barber);
  if exists (select from waiting_list where client_id = v_client and desired_date = p_date and status = 'ativo') then return 'ok'; end if;
  insert into waiting_list (barbershop_id, client_id, service_id, barber_id, desired_date, window_start, window_end, notes)
    values (p_shop, v_client, p_service, p_barber, p_date, p_from, p_to, 'Entrou pelo site');
  insert into notifications (barbershop_id, title, body, link)
    values (p_shop, 'Novo cliente na fila de espera', p_name || ' pediu horário pelo site para ' || to_char(p_date, 'DD/MM'), '/fila');
  return 'ok';
end $$;

revoke all on all functions in schema public from public;
grant execute on function
  auth_login_allowed(text, text), auth_login_record(text, text, boolean), auth_user_for_login(text),
  auth_session_create(uuid, bytea, text, text), auth_session_get(bytea), auth_session_delete(bytea),
  auth_register(text, text, text, text, text), auth_own_hash(), auth_set_password(uuid, text, bytea),
  auth_register_v2(text, text, text, text, text, text), auth_set_recovery(bytea), auth_has_recovery(), auth_recover(text, bytea, text, text),
  offer_accept(uuid), offer_public_get(bytea), offer_public_respond(bytea, boolean),
  day_busy(date), public_shop(text), public_book(uuid, uuid, uuid, date, time, text, text, text),
  public_wait(uuid, uuid, uuid, date, time, time, text, text, text),
  app_shop(), app_user(), app_barber(), app_role(), app_is_staff() to barber_app;
