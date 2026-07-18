-- Storage bucket for profile avatars.
-- Run this against the Supabase project (SQL editor or `supabase db push`).

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Public read (bucket is public, but RLS still gates the storage.objects table).
drop policy if exists "avatars are publicly readable" on storage.objects;
create policy "avatars are publicly readable"
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');

-- Users can only write/replace/delete a file named after their own user id
-- (the app uploads as "<user_id>.jpg" — see profile.tsx), not anyone else's.
-- UUIDs never contain a period, so splitting on "." to get the name before
-- the extension is a safe way to match regardless of file extension.
drop policy if exists "users can upload their own avatar" on storage.objects;
create policy "users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and split_part(name, '.', 1) = auth.uid()::text);

drop policy if exists "users can update their own avatar" on storage.objects;
create policy "users can update their own avatar"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and split_part(name, '.', 1) = auth.uid()::text);

drop policy if exists "users can delete their own avatar" on storage.objects;
create policy "users can delete their own avatar"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and split_part(name, '.', 1) = auth.uid()::text);
