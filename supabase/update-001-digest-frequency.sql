-- Run once in Supabase > SQL Editor on an existing project.
alter table public.profiles
  add column if not exists digest_every_days integer not null default 1
  check (digest_every_days between 1 and 14);
