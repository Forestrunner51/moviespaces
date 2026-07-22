-- Direct messages are meant to be friends-only, but the original insert policy
-- only checked `auth.uid() = sender_id` — that proves you're sending as
-- yourself, not that the recipient is your friend. Any client with the anon key
-- could therefore DM any user regardless of the UI (an unsolicited-message /
-- harassment vector). Tighten the policy so a message can only be inserted when
-- an *accepted* friendship exists between sender and receiver.
--
-- Self-contained on purpose: recreates the `messages` table/index/RLS if they
-- are missing, so this migration is correct whether or not the table currently
-- exists (e.g. if an earlier "remove direct messages" migration dropped it).
-- All statements are idempotent — safe to re-run.

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

-- Insert requires an accepted friendship between the two users (either direction).
drop policy if exists "users can send messages as themselves" on public.messages;
drop policy if exists "users can send messages to friends only" on public.messages;
create policy "users can send messages to friends only"
  on public.messages for insert
  to authenticated
  with check (
    auth.uid() = sender_id
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
