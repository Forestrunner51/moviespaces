-- Pre-launch security hardening for the Supabase (supabase-js / RLS) layer.
-- Hand-apply via the Supabase dashboard SQL editor — this project has no
-- CLI-tracked migrations. Every statement is idempotent (drop-if-exists +
-- recreate, IF NOT EXISTS, CREATE OR REPLACE), so it is safe to run twice.
--
-- Blocks in this file:
--   1. friendships UPDATE: receiver-only. The old policy let either side
--      update, so a requester could flip their own request to 'accepted'.
--      The client only ever UPDATEs to accept (use-friends.ts
--      acceptFriendRequest); cancel/decline/unfriend are all DELETEs, which
--      keep their existing either-side policy.
--   2. Block enforcement. is_blocked_between(a, b) is true when either user
--      has blocked the other (public.blocks). It is folded into the existing
--      permissive policies for DM select/insert, group-chat select and
--      friend-request insert, rather than adding a second permissive policy
--      (permissive policies OR together, which would NOT tighten anything).
--   3. Storage buckets: 5 MB size cap + image-only MIME allowlist on the
--      'avatars' and 'space-photos' buckets.
--   4. Index on messages (receiver_id, created_at) for the DM unread badge
--      query in use-dm-unread-counts.ts (receiver_id = me and created_at > floor).

-- ── 2a. helper ──────────────────────────────────────────────────────────
-- security definer: blocks RLS only lets a user see rows they authored, but
-- the policies below also need to know whether the *other* party blocked
-- the caller. Pinned search_path so a definer function can't be hijacked.
create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.blocks bl
    where (bl.blocker_id = a and bl.blocked_id = b)
       or (bl.blocker_id = b and bl.blocked_id = a)
  );
$$;

revoke all on function public.is_blocked_between(uuid, uuid) from public;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;

-- Serves the (blocker_id = b and blocked_id = a) half of the helper; the
-- primary key (blocker_id, blocked_id) already serves the other half.
create index if not exists blocks_blocked_idx on public.blocks (blocked_id, blocker_id);

-- ── 1. friendships UPDATE: receiver only ────────────────────────────────
drop policy if exists "receiver can respond, either side can update" on public.friendships;
drop policy if exists "receiver can respond to a friend request" on public.friendships;
create policy "receiver can respond to a friend request"
  on public.friendships for update
  to authenticated
  using (auth.uid() = receiver_id)
  with check (auth.uid() = receiver_id);

-- ── 2b. friendships INSERT: no requests across a block ──────────────────
drop policy if exists "users can send friend requests" on public.friendships;
create policy "users can send friend requests"
  on public.friendships for insert
  to authenticated
  with check (
    auth.uid() = requester_id
    and not public.is_blocked_between(auth.uid(), receiver_id)
  );

-- ── 2c. messages (DMs) SELECT/INSERT ────────────────────────────────────
drop policy if exists "participants can read their messages" on public.messages;
create policy "participants can read their messages"
  on public.messages for select
  to authenticated
  using (
    (auth.uid() = sender_id or auth.uid() = receiver_id)
    and not public.is_blocked_between(
      auth.uid(),
      case when auth.uid() = sender_id then receiver_id else sender_id end
    )
  );

-- Same friends-only rule as 20260722_dm_friends_only.sql, plus the block check.
drop policy if exists "users can send messages as themselves" on public.messages;
drop policy if exists "users can send messages to friends only" on public.messages;
create policy "users can send messages to friends only"
  on public.messages for insert
  to authenticated
  with check (
    auth.uid() = sender_id
    and not public.is_blocked_between(auth.uid(), receiver_id)
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.receiver_id = messages.receiver_id)
          or
          (f.receiver_id = auth.uid() and f.requester_id = messages.receiver_id)
        )
    )
  );

-- ── 2d. group_messages SELECT: hide blocked senders ─────────────────────
-- Own messages are always visible (is_blocked_between(x, x) is false since
-- blocks has no self-rows worth honouring; the explicit check makes it clear).
drop policy if exists "members can read group messages" on public.group_messages;
create policy "members can read group messages"
  on public.group_messages for select
  to authenticated
  using (
    public.is_group_message_member(group_type, group_id)
    and (
      auth.uid() = sender_id
      or not public.is_blocked_between(auth.uid(), sender_id)
    )
  );

-- ── 3. storage bucket limits ────────────────────────────────────────────
update storage.buckets
set file_size_limit = 5242880,  -- 5 MB
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
where id in ('avatars', 'space-photos');

-- ── 4. DM unread index ──────────────────────────────────────────────────
create index if not exists messages_receiver_created_idx
  on public.messages (receiver_id, created_at);
