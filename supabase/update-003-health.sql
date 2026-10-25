-- Run once in Supabase > SQL Editor, BEFORE deploying the health check code.

create table if not exists public.health_cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  plant_id uuid not null references public.plants on delete cascade,
  status text not null default 'open' check (status in ('open', 'resolved')),
  issue text not null,
  category text,
  confidence text,
  plan jsonb not null default '{}'::jsonb,
  repeat_every_days integer,
  next_check_on date,
  opened_on date not null,
  resolved_on date,
  created_at timestamptz not null default now()
);
create index if not exists health_cases_plant on public.health_cases (plant_id, status);
create index if not exists health_cases_user on public.health_cases (user_id, status, next_check_on);

create table if not exists public.health_updates (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.health_cases on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  plant_id uuid not null references public.plants on delete cascade,
  kind text not null check (kind in ('diagnosis', 'better', 'same', 'worse', 'resolved')),
  note text,
  photo_path text,
  advice text,
  next_steps jsonb,
  created_at timestamptz not null default now()
);
create index if not exists health_updates_case on public.health_updates (case_id, created_at);

alter table public.health_cases enable row level security;
alter table public.health_updates enable row level security;

drop policy if exists "own health cases" on public.health_cases;
create policy "own health cases" on public.health_cases
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own health updates" on public.health_updates;
create policy "own health updates" on public.health_updates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
