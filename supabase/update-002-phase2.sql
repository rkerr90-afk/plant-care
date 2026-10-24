-- Run once in Supabase > SQL Editor, BEFORE deploying the Phase 2 code.
alter table public.profiles
  add column if not exists away_from date,
  add column if not exists away_until date,
  add column if not exists last_frost_on date;
