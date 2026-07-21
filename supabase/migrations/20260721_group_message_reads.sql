-- Tracks the last time a user viewed a given group's chat, so the app can
-- count messages sent after that point ("N new messages" badges) without
-- needing a separate read/unread flag per message row.
create table if not exists public.group_message_reads (
    user_id uuid not null references auth.users (id) on delete cascade,
    group_type text not null check (group_type in ('group', 'crowdfund')),
    group_id uuid not null,
    last_read_at timestamptz not null default now(),
    primary key (user_id, group_type, group_id)
);

alter table public.group_message_reads enable row level security;

drop policy if exists "users can read their own read markers" on public.group_message_reads;
create policy "users can read their own read markers"
  on public.group_message_reads for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "users can upsert their own read markers" on public.group_message_reads;
create policy "users can upsert their own read markers"
  on public.group_message_reads for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "users can update their own read markers" on public.group_message_reads;
create policy "users can update their own read markers"
  on public.group_message_reads for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
