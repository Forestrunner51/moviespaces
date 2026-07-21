-- Unique @username handle, separate from the freeform, non-unique
-- display_name. Nullable — existing accounts have none until they set one.
-- Stored lowercase (enforced by the check constraint) so lookups are always
-- a plain equality match, no case-insensitive index needed.
alter table public.profiles
  add column if not exists username text
  constraint username_format check (username is null or username ~ '^[a-z0-9_]{3,30}$');

create unique index if not exists profiles_username_unique_idx
  on public.profiles (username)
  where username is not null;
