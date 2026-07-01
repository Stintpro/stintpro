-- StintPro — esquema Supabase
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query

-- ── TABLA: profiles ──────────────────────────────────────────────────────
-- Extiende auth.users con rol y nombre. Se crea via Vercel Function (service role).
create table if not exists profiles (
  id         uuid primary key references auth.users on delete cascade,
  email      text not null,
  name       text not null default '',
  role       text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz default now()
);

-- RLS: cada usuario solo puede leer su propio perfil.
-- El panel admin usa service role vía Vercel Function → no necesita política de lectura amplia.
-- INSERT/UPDATE/DELETE solo via service role (Vercel Function) → no hay política cliente.
alter table profiles enable row level security;

create policy "users read own profile"
  on profiles for select
  to authenticated
  using (id = auth.uid());


-- ── TABLA: circuits ───────────────────────────────────────────────────────
create table if not exists circuits (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  port       integer not null default 7913,
  created_at timestamptz default now()
);

-- RLS: todos los autenticados leen; solo admin escribe
alter table circuits enable row level security;

create policy "auth users can read circuits"
  on circuits for select
  to authenticated
  using (true);

create policy "admin can write circuits"
  on circuits for all
  to authenticated
  using     ( (select role from profiles where id = auth.uid()) = 'admin' )
  with check( (select role from profiles where id = auth.uid()) = 'admin' );


-- ── PRIMER ADMIN ─────────────────────────────────────────────────────────
-- 1. Crea el usuario en Supabase Dashboard → Authentication → Users → Add user
-- 2. Copia su UUID y ejecuta:
--
--    insert into profiles (id, email, name, role)
--    values ('<UUID>', '<email>', '<nombre>', 'admin');
--
-- A partir de ahí el admin puede crear el resto de usuarios desde la app.
