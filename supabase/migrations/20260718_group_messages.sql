-- Group chat for both free Groups (RSVP) and crowdfunded Spaces.
-- Run this against the Supabase project (SQL editor or `supabase db push`).
--
-- This is a single shared table (group_type discriminator) rather than two
-- parallel ones, since both group shapes ("who's in it") already exist —
-- GroupMembers for free Groups, space_pledges for crowdfund Spaces — this
-- table just needs to reference the right one per row.
--
-- Membership is enforced via RLS subqueries directly against those existing
-- tables. "Groups"/"GroupMembers" are EF Core-owned (quoted PascalCase
-- columns, user_id stored as text) — no schema change to them needed here,
-- this migration only reads from them.

create table if not exists public.group_messages (
    id uuid primary key default gen_random_uuid(),
    group_type text not null check (group_type in ('group', 'crowdfund')),
    group_id uuid not null,
    sender_id uuid not null references auth.users (id) on delete cascade,
    content text not null check (char_length(content) > 0),
    created_at timestamptz not null default now()
);

create index if not exists group_messages_group_idx
  on public.group_messages (group_type, group_id, created_at);

alter table public.group_messages enable row level security;

-- Membership check, shared by both the select and insert policies below.
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
        select 1 from "GroupMembers" gm
        where gm."GroupId" = p_group_id and gm.user_id = auth.uid()::text
      )
    when 'crowdfund' then
      exists (
        select 1 from spaces s
        where s.id = p_group_id and s.creator_id = auth.uid()
      )
      or exists (
        select 1 from space_pledges sp
        where sp.space_id = p_group_id and sp.user_id = auth.uid()
      )
    else false
  end;
$$;

drop policy if exists "members can read group messages" on public.group_messages;
create policy "members can read group messages"
  on public.group_messages for select
  to authenticated
  using (public.is_group_message_member(group_type, group_id));

drop policy if exists "members can send group messages" on public.group_messages;
create policy "members can send group messages"
  on public.group_messages for insert
  to authenticated
  with check (
    auth.uid() = sender_id
    and public.is_group_message_member(group_type, group_id)
  );
