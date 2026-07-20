-- Lets a user record which theater loyalty programs they belong to
-- (AMC Stubs/A-List, Regal Crown Club/Unlimited, Cinemark Movie Club, etc.)
-- so hosts/guests can see it on a profile. Comma-separated tags, same
-- pattern as Groups.post_activities on the EF side — avoids array-column
-- mapping complexity for what's just a handful of tags.
alter table public.profiles
  add column if not exists theater_memberships text;
