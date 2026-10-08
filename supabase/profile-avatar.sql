-- Run after menu-features.sql in Supabase SQL Editor.
-- The existing owner-only profile policies also protect this field.
alter table public.profiles add column if not exists avatar text not null default 'bunny';
alter table public.profiles drop constraint if exists profiles_avatar_allowed;
alter table public.profiles add constraint profiles_avatar_allowed check
  (avatar in ('mouse','cow','tiger','bunny','dragon','snake','horse','sheep','monkey','chicken','dog','pig'));
