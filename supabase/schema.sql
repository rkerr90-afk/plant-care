-- Plant Care: database schema. Run once in Supabase > SQL Editor.

-- One row per user, created automatically on sign-up.
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  postcode text,
  latitude double precision,
  longitude double precision,
  digest_time time not null default '12:00',
  digest_every_days integer not null default 1 check (digest_every_days between 1 and 14),
  timezone text not null default 'Europe/London',
  has_pets boolean not null default false,
  last_digest_on date,
  ai_calls_on date,
  ai_calls_today integer not null default 0,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Care profiles cached per species, shared by all users (a second pothos costs nothing).
create table public.species_profiles (
  key text primary key,               -- lower-cased scientific name
  scientific_name text not null,
  common_name text not null,
  profile jsonb not null,
  created_at timestamptz not null default now()
);

create table public.plants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  nickname text not null,
  species_key text not null references public.species_profiles(key),
  setting text not null check (setting in ('indoor', 'outdoor')),
  spot text,
  light text check (light in ('bright_direct', 'bright_indirect', 'medium', 'low')),
  near_heat boolean not null default false,
  exposure text check (exposure in ('exposed', 'sheltered')),
  pot_material text check (pot_material in ('plastic', 'terracotta', 'glazed', 'other')),
  has_drainage boolean,
  pot_size text check (pot_size in ('small', 'medium', 'large')),
  needs_context boolean not null default false,
  photo_path text,
  feedback_factor numeric not null default 1,
  last_watered_on date,
  next_due_on date,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now()
);
create index plants_user_due on public.plants (user_id, next_due_on) where status = 'active';

create table public.events (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('added', 'watered', 'still_moist', 'bone_dry', 'species_changed', 'note')),
  detail text,
  created_at timestamptz not null default now()
);
create index events_plant on public.events (plant_id, created_at desc);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- Row level security: each user sees only their own rows.
alter table public.profiles enable row level security;
alter table public.species_profiles enable row level security;
alter table public.plants enable row level security;
alter table public.events enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "read species" on public.species_profiles
  for select to authenticated using (true);
create policy "own plants" on public.plants
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own events" on public.events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own subscriptions" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Private bucket for plant photos. The app reads and writes it server-side only.
insert into storage.buckets (id, name, public) values ('plant-photos', 'plant-photos', false)
  on conflict do nothing;
