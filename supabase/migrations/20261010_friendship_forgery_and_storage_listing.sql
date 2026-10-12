-- Security fixes from the 2026-10-10 audit. Hand-apply via the Supabase
-- dashboard SQL editor, like the other files here. Idempotent: safe to run
-- twice.
--
--   1. Friendship forgery. The INSERT policy checked who sent a request but
--      not its status, so a user could insert {requester: me, receiver:
--      anyone, status: 'accepted'} and be instantly "friends" with anyone,
--      which unlocks the friends-only DM policy. The receiver-only UPDATE
--      policy had a second hole: with check only pinned receiver_id, so the
--      receiver of any request could rewrite requester_id to a stranger and
--      accept that. Now: inserts must be 'pending', the only update is
--      receiver pending -> accepted, and a trigger refuses any change to
--      the two ids. (A trigger, not a column-level REVOKE: it holds no
--      matter what table grants exist, including the blanket grants
--      backend.IntegrationTests applies after these files.)
--   2. Storage listing. The public-read SELECT policies on 'avatars' and
--      'space-photos' let anyone with the anon key list every object name
--      in those buckets (and avatar names are user ids). Public buckets
--      serve /object/public/... URLs without consulting RLS, which is how
--      the app shows every image (getPublicUrl), so SELECT only needs to
--      cover the owner's own files: avatar upsert reads the existing
--      object before replacing it.

-- ── 1. friendships ──────────────────────────────────────────────────────
drop policy if exists "users can send friend requests" on public.friendships;
create policy "users can send friend requests"
  on public.friendships for insert
  to authenticated
  with check (
    auth.uid() = requester_id
    and status = 'pending'
    and not public.is_blocked_between(auth.uid(), receiver_id)
  );

drop policy if exists "receiver can respond to a friend request" on public.friendships;
create policy "receiver can respond to a friend request"
  on public.friendships for update
  to authenticated
  using (auth.uid() = receiver_id and status = 'pending')
  with check (auth.uid() = receiver_id and status = 'accepted');

create or replace function public.friendships_ids_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.requester_id is distinct from old.requester_id
     or new.receiver_id is distinct from old.receiver_id then
    raise exception 'friendship participants cannot be changed'
      using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists friendships_ids_immutable on public.friendships;
create trigger friendships_ids_immutable
  before update on public.friendships
  for each row execute function public.friendships_ids_immutable();

-- ── 2. storage listing ──────────────────────────────────────────────────
drop policy if exists "avatars are publicly readable" on storage.objects;
drop policy if exists "users can read their own avatar" on storage.objects;
create policy "users can read their own avatar"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars' and split_part(name, '.', 1) = auth.uid()::text);

drop policy if exists "space photos are publicly readable" on storage.objects;
drop policy if exists "users can read their own space photos" on storage.objects;
create policy "users can read their own space photos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'space-photos' and (storage.foldername(name))[1] = auth.uid()::text);
