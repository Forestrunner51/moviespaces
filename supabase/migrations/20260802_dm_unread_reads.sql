-- Extends group_message_reads (already used for Space chat "N new messages"
-- badges) to also cover DMs, so friends.tsx can show the same kind of badge.
-- DMs live in the separate `messages` table (sender_id/receiver_id), not
-- group_messages — group_id here is the *other* user's id, group_type 'dm'
-- distinguishes it from a real group/Space row with the same uuid shape.
alter table public.group_message_reads
  drop constraint if exists group_message_reads_group_type_check;

alter table public.group_message_reads
  add constraint group_message_reads_group_type_check
  check (group_type in ('group', 'crowdfund', 'dm'));
