-- Run in a NEW Supabase project's SQL Editor before connecting the app.
-- No service-role key is used by the Python server.
create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  name text not null check (char_length(name) between 1 and 160),
  date date not null,
  note text not null check (char_length(note) between 1 and 10000),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  photos text[] not null default '{}' check (cardinality(photos) <= 4),
  created_at timestamptz not null default now()
);
create index if not exists entries_owner_date on public.entries(user_id, date desc);
alter table public.entries enable row level security;
revoke all on public.entries from anon;
grant select, insert, update, delete on public.entries to authenticated;

-- Photo paths must start with the same account's UUID.
create or replace function public.owned_photo_paths(paths text[], owner_id uuid)
returns boolean language sql immutable set search_path = '' as $$
  select not exists (
    select 1 from unnest(paths) as p
    where p is null or split_part(p, '/', 1) <> owner_id::text
  );
$$;
alter table public.entries drop constraint if exists entry_photo_owner;
alter table public.entries add constraint entry_photo_owner
  check (public.owned_photo_paths(photos, user_id));

drop policy if exists "Read own memories" on public.entries;
create policy "Read own memories" on public.entries for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Create own memories" on public.entries;
create policy "Create own memories" on public.entries for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "Edit own memories" on public.entries;
create policy "Edit own memories" on public.entries for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Delete own memories" on public.entries;
create policy "Delete own memories" on public.entries for delete to authenticated
  using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('journal-photos', 'journal-photos', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Read own journal photos" on storage.objects;
create policy "Read own journal photos" on storage.objects for select to authenticated
  using (bucket_id = 'journal-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Upload own journal photos" on storage.objects;
create policy "Upload own journal photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'journal-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Delete own journal photos" on storage.objects;
create policy "Delete own journal photos" on storage.objects for delete to authenticated
  using (bucket_id = 'journal-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- No UPDATE policy: uploaded photo objects are immutable.
