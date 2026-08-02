-- Storage bucket for host-uploaded Space cover photos (non-movie/TV
-- watch-party events only — movie/TV Spaces keep using the OMDb poster).
-- Run this against the Supabase project (SQL editor or `supabase db push`).

insert into storage.buckets (id, name, public)
values ('space-photos', 'space-photos', true)
on conflict (id) do nothing;

-- Public read (bucket is public, but RLS still gates the storage.objects table).
drop policy if exists "space photos are publicly readable" on storage.objects;
create policy "space photos are publicly readable"
  on storage.objects for select
  to public
  using (bucket_id = 'space-photos');

-- Unlike avatars (one file per user, named "<user_id>.jpg"), a host can
-- upload a cover photo for many different Spaces, so the file is namespaced
-- under a folder named after the uploader instead of being a single fixed
-- filename — "<user_id>/<timestamp>.jpg" (see create-space.tsx). Matching
-- against the folder (storage.foldername) rather than the whole object name
-- means a host can freely upload/replace/delete any photo under their own
-- folder, but never touch another user's.
drop policy if exists "users can upload their own space photos" on storage.objects;
create policy "users can upload their own space photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'space-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users can update their own space photos" on storage.objects;
create policy "users can update their own space photos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'space-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users can delete their own space photos" on storage.objects;
create policy "users can delete their own space photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'space-photos' and (storage.foldername(name))[1] = auth.uid()::text);
