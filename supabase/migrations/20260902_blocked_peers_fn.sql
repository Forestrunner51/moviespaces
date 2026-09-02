-- Hand-applied via the Supabase SQL editor (no CLI-tracked migrations).
-- Idempotent: safe to run twice.
--
-- blocked_peer_ids(): every user the caller has a block with, in EITHER
-- direction. RLS on public.blocks only lets a user read rows they created,
-- which is right for privacy but means the client can't hide people who
-- blocked *them* from social surfaces (friend suggestions, "recently met").
-- This SECURITY DEFINER function returns the combined set without saying
-- which direction each block runs — the caller learns "don't show these
-- people", not "these people blocked you". (Absence is still inferable by a
-- determined user; that's inherent to hiding them at all, and the RLS
-- policies from 20260829 already refuse contact both ways regardless.)

create or replace function public.blocked_peer_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select blocked_id  from public.blocks where blocker_id = auth.uid()
  union
  select blocker_id from public.blocks where blocked_id = auth.uid()
$$;

revoke all on function public.blocked_peer_ids() from public, anon;
grant execute on function public.blocked_peer_ids() to authenticated;
