-- Onboarding taste picks: top-3 favorite / least-favorite movies, stored as
-- jsonb arrays of {imdbId,title,posterPath}. Optional (skippable) — null when
-- the user skipped. Written by the owner only; readable wherever profiles are.
alter table public.profiles
  add column if not exists favorite_movies jsonb,
  add column if not exists least_favorite_movies jsonb;
