-- Hand-applied via the Supabase SQL editor (no CLI-tracked migrations).
-- FIXED 2026-09-04 (v2): the first version referenced the PascalCase
-- property names for match_movie_key / is_public / screening_time, but
-- those map to snake_case columns — the CREATE errored, so if you tried
-- v1 the rule never landed. Re-run this version.
-- Idempotent: create or replace.
--
-- Group chat now requires being MARKED GOING for hosted Spaces — the client
-- has hidden the Chat button for unconfirmed members since 2026-09-03, but
-- that was UI-only: a push-notification deep link (or a raw API call) still
-- read and wrote the chat. This puts the rule where it's real.
--
-- Who can read/write a group chat, mirroring the client's chatUnlocked:
--   · the host, always
--   · a member who is Confirmed ("Going")
--   · any member of a CREW  (MatchMovieKey set — taking a seat IS the
--     commitment; the backend auto-confirms crew joins anyway)
--   · any member of a CLUB  (IsPublic without MatchMovieKey — clubs are
--     pure chat, there is nothing to confirm attendance TO)
--   · any member once the event has PASSED (the conversation is history
--     they were part of, and the Confirm button no longer renders)

create or replace function public.is_group_message_member(p_group_type text, p_group_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select case p_group_type
    when 'group' then
      exists (
        select 1 from "Groups" g
        where g."Id" = p_group_id and g.user_id = auth.uid()::text
      )
      or exists (
        select 1
        from "GroupMembers" gm
        join "Groups" g on g."Id" = gm."GroupId"
        where gm."GroupId" = p_group_id
          and gm.user_id = auth.uid()::text
          and (
            gm."Confirmed"
            or g.match_movie_key is not null
            or (g.is_public and g.match_movie_key is null)
            or (g.screening_time is not null and g.screening_time < now())
          )
      )
    else false
  end;
$$;
