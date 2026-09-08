-- Hand-applied via the Supabase SQL editor (no CLI-tracked migrations).
-- Idempotent: safe to run twice.
--
-- Realtime for chat. The app subscribes to INSERTs on group_messages (per
-- Space) and messages (per recipient) via Supabase Realtime's
-- postgres_changes, and drops its poll from every 4s to a 30s safety net
-- while the subscription is healthy — see hooks/use-realtime-inserts.ts.
--
-- postgres_changes only streams tables in the `supabase_realtime`
-- publication, and it evaluates each table's SELECT RLS policy per
-- subscriber, so the membership/block rules in 20260904 and 20260829 apply
-- to the live feed exactly as they do to a query. Nothing here loosens
-- access; it only turns on the change stream.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_messages'
  ) then
    alter publication supabase_realtime add table public.group_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
