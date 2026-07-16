-- Friends + messaging schema for MovieSpaces.
-- Run this against the Supabase project (SQL editor or `supabase db push`).
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE throughout.

-- ── profiles ────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Unknown User',
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable by any authenticated user" on public.profiles;
create policy "profiles are readable by any authenticated user"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "users can insert their own profile" on public.profiles;
create policy "users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', 'Unknown User'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── friendships ─────────────────────────────────────────────────────────
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  receiver_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint no_self_friendship check (requester_id <> receiver_id),
  constraint unique_pair unique (requester_id, receiver_id)
);

create index if not exists friendships_requester_idx on public.friendships (requester_id);
create index if not exists friendships_receiver_idx on public.friendships (receiver_id);

alter table public.friendships enable row level security;

drop policy if exists "participants can read their friendships" on public.friendships;
create policy "participants can read their friendships"
  on public.friendships for select
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = receiver_id);

drop policy if exists "users can send friend requests" on public.friendships;
create policy "users can send friend requests"
  on public.friendships for insert
  to authenticated
  with check (auth.uid() = requester_id);

drop policy if exists "receiver can respond, either side can update" on public.friendships;
create policy "receiver can respond, either side can update"
  on public.friendships for update
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = receiver_id)
  with check (auth.uid() = requester_id or auth.uid() = receiver_id);

drop policy if exists "participants can delete their friendship" on public.friendships;
create policy "participants can delete their friendship"
  on public.friendships for delete
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = receiver_id);

-- ── messages ────────────────────────────────────────────────────────────
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  receiver_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(content) > 0),
  created_at timestamptz not null default now()
);

create index if not exists messages_thread_idx
  on public.messages (least(sender_id, receiver_id), greatest(sender_id, receiver_id), created_at);

alter table public.messages enable row level security;

drop policy if exists "participants can read their messages" on public.messages;
create policy "participants can read their messages"
  on public.messages for select
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "users can send messages as themselves" on public.messages;
create policy "users can send messages as themselves"
  on public.messages for insert
  to authenticated
  with check (auth.uid() = sender_id);
