-- App Store / Play Store content-moderation prerequisite: every UGC surface
-- needs a report affordance, and users need to be able to block each other.
-- target_type/target_id are a loose reference (not a FK) since reportable
-- content spans both this Supabase project (chat messages) and the separate
-- .NET/Postgres backend (Spaces) — a single generic table covers both.
create table if not exists public.reports (
    id uuid primary key default gen_random_uuid(),
    reporter_id uuid not null references auth.users (id) on delete cascade,
    target_type text not null check (target_type in ('message', 'space', 'user')),
    target_id text not null,
    reason text,
    created_at timestamptz not null default now()
);

alter table public.reports enable row level security;

drop policy if exists "users can file their own reports" on public.reports;
create policy "users can file their own reports"
  on public.reports for insert
  to authenticated
  with check (auth.uid() = reporter_id);

-- Blocking hides a user's messages/spaces from the blocker. No FK to profiles
-- (blocked_id can outlive a deleted account) but always scoped to the caller.
create table if not exists public.blocks (
    blocker_id uuid not null references auth.users (id) on delete cascade,
    blocked_id uuid not null,
    created_at timestamptz not null default now(),
    primary key (blocker_id, blocked_id)
);

alter table public.blocks enable row level security;

drop policy if exists "users can view their own blocks" on public.blocks;
create policy "users can view their own blocks"
  on public.blocks for select
  to authenticated
  using (auth.uid() = blocker_id);

drop policy if exists "users can create their own blocks" on public.blocks;
create policy "users can create their own blocks"
  on public.blocks for insert
  to authenticated
  with check (auth.uid() = blocker_id);

drop policy if exists "users can remove their own blocks" on public.blocks;
create policy "users can remove their own blocks"
  on public.blocks for delete
  to authenticated
  using (auth.uid() = blocker_id);
