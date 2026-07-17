-- Crowdfunding/pledge-based group screenings.
-- Run this against the Supabase project (SQL editor or `supabase db push`).
-- NOTE: table names ("spaces", "space_pledges") do not collide with the
-- existing EF Core "Groups"/"GroupMembers"/"MovieSpaces" tables used by the
-- .NET backend, but they represent an overlapping real-world concept
-- (private group movie outings) — see conversation for the open question on
-- how these two systems are meant to relate before building Part 2 (API) on
-- top of this schema.

-- Status is plain text + a check constraint rather than a native Postgres
-- enum — matches the existing Group.Status convention in the .NET backend
-- (see Models/Groups.cs) and avoids needing Npgsql enum type registration.

-- ── spaces ──────────────────────────────────────────────────────────────
create table if not exists public.spaces (
    id uuid primary key default gen_random_uuid(),
    movie_id varchar(255) not null,
    movie_title varchar(255) not null,
    movie_poster_url text,
    theater_id varchar(255) not null,
    theater_name varchar(255) not null,
    showtime timestamptz not null,
    target_amount numeric(10, 2) not null,
    current_amount numeric(10, 2) not null default 0.00,
    deadline timestamptz not null,
    status text not null default 'funding'
      check (status in ('funding', 'successful', 'failed', 'cancelled')),
    creator_id uuid not null references auth.users (id) on delete cascade,
    -- Caps how many people can pledge into this space. Set for a full theater
    -- rental (fixed seat count); left null for a normal public-showtime
    -- crowdfund, where there's no natural participant cap.
    max_participants integer,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint chk_deadline check (deadline < showtime),
    constraint chk_target_amount check (target_amount > 0),
    constraint chk_max_participants check (max_participants is null or max_participants > 0)
);

create index if not exists spaces_status_idx on public.spaces (status);
create index if not exists spaces_creator_idx on public.spaces (creator_id);
create index if not exists spaces_deadline_idx on public.spaces (deadline) where status = 'funding';

alter table public.spaces enable row level security;

drop policy if exists "anyone authenticated can read spaces" on public.spaces;
create policy "anyone authenticated can read spaces"
  on public.spaces for select
  to authenticated
  using (true);

drop policy if exists "users can create their own space" on public.spaces;
create policy "users can create their own space"
  on public.spaces for insert
  to authenticated
  with check (auth.uid() = creator_id);

-- current_amount/status are server-managed (via the .NET backend using the
-- service role key during Stripe webhook processing), so client-side update
-- is intentionally restricted to the creator cancelling their own space.
drop policy if exists "creator can cancel their own space" on public.spaces;
create policy "creator can cancel their own space"
  on public.spaces for update
  to authenticated
  using (auth.uid() = creator_id)
  with check (auth.uid() = creator_id);

-- ── space_pledges ───────────────────────────────────────────────────────
create table if not exists public.space_pledges (
    id uuid primary key default gen_random_uuid(),
    space_id uuid not null references public.spaces (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    pledge_amount numeric(10, 2) not null,
    stripe_intent_id varchar(255) not null,
    status text not null default 'authorized'
      check (status in ('authorized', 'captured', 'released', 'failed')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint chk_pledge_amount check (pledge_amount > 0),
    unique (space_id, user_id)
);

create index if not exists space_pledges_space_idx on public.space_pledges (space_id);
create index if not exists space_pledges_user_idx on public.space_pledges (user_id);
create unique index if not exists space_pledges_stripe_intent_idx on public.space_pledges (stripe_intent_id);

alter table public.space_pledges enable row level security;

drop policy if exists "participants can read pledges on visible spaces" on public.space_pledges;
create policy "participants can read pledges on visible spaces"
  on public.space_pledges for select
  to authenticated
  using (true);

-- Inserts happen server-side (backend creates the Stripe PaymentIntent first,
-- then writes the row with the resulting intent id) — no direct client insert
-- policy is granted here on purpose; the backend uses the service role key.

-- ── space_interests ─────────────────────────────────────────────────────
-- Free, no-payment "I'm interested" signal — the step before someone
-- decides to actually pledge money. Doesn't touch Stripe/the .NET backend
-- at all, so (like friendships/messages) the app talks to this table
-- directly via supabase-js, gated by RLS. Interested-but-unpaid people do
-- NOT count toward spaces.max_participants or current_amount — only real
-- pledges (space_pledges) do.
create table if not exists public.space_interests (
    id uuid primary key default gen_random_uuid(),
    space_id uuid not null references public.spaces (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    created_at timestamptz not null default now(),
    unique (space_id, user_id)
);

create index if not exists space_interests_space_idx on public.space_interests (space_id);
create index if not exists space_interests_user_idx on public.space_interests (user_id);

alter table public.space_interests enable row level security;

drop policy if exists "anyone authenticated can read interest" on public.space_interests;
create policy "anyone authenticated can read interest"
  on public.space_interests for select
  to authenticated
  using (true);

drop policy if exists "users can mark their own interest" on public.space_interests;
create policy "users can mark their own interest"
  on public.space_interests for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "users can remove their own interest" on public.space_interests;
create policy "users can remove their own interest"
  on public.space_interests for delete
  to authenticated
  using (auth.uid() = user_id);
