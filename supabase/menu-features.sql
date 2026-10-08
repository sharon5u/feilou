-- Run once in Supabase SQL Editor to add Flight tracker and Profile.
-- Safe to rerun. Existing memories and accounts are preserved.
create table if not exists public.flights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  flight_number text not null check (char_length(flight_number) between 1 and 20),
  airline text not null default '' check (char_length(airline) <= 80),
  date date not null,
  seat text not null default '' check (char_length(seat) <= 10),
  origin text not null check (char_length(origin) between 1 and 160),
  destination text not null check (char_length(destination) between 1 and 160),
  origin_lat double precision not null check (origin_lat between -90 and 90),
  origin_lng double precision not null check (origin_lng between -180 and 180),
  destination_lat double precision not null check (destination_lat between -90 and 90),
  destination_lng double precision not null check (destination_lng between -180 and 180),
  check (origin_lat <> destination_lat or origin_lng <> destination_lng),
  created_at timestamptz not null default now()
);
create index if not exists flights_owner_date on public.flights(user_id, date desc);
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '' check (char_length(name) <= 100),
  birthday date,
  hometown text not null default '' check (char_length(hometown) <= 120),
  home_country text not null default '' check (char_length(home_country) <= 80),
  bio text not null default '' check (char_length(bio) <= 1000)
);
alter table public.flights enable row level security;
alter table public.profiles enable row level security;
revoke all on public.flights, public.profiles from anon;
grant select, insert, update, delete on public.flights to authenticated;
grant select, insert, update on public.profiles to authenticated;

drop policy if exists "Own flights" on public.flights;
create policy "Own flights" on public.flights for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Own profile" on public.profiles;
create policy "Own profile" on public.profiles for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
