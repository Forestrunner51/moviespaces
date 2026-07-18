-- Removes the Stripe-based crowdfunding feature (spaces/space_pledges/
-- space_interests) — the app has pivoted to a pure social-coordination
-- model (free RSVP via the .NET Group/GroupMember tables + external ticket
-- links), no in-app payments. Run this against the Supabase project.
--
-- group_messages is left in place (still used for Group chat) — only the
-- 'crowdfund' group_type value stops being written going forward.

drop table if exists public.space_pledges cascade;
drop table if exists public.space_interests cascade;
drop table if exists public.spaces cascade;
