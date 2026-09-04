# MovieSpaces — App Store Launch Checklist

Rewritten 2026‑09‑04. Everything engineering-side is DONE and merged to
`main`; what remains is ops, device QA, and App Store Connect. Work top to
bottom — each phase gates the next.

Key facts:
- Bundle ID: `com.newfahrenheit45.Moviespaces`
- Apple Team ID: `8J48NY9S42`
- EAS project: `16d58e9a-1828-40c1-b2a2-34b37fc4fe20` · ASC app: `6790220852`
- Supabase project: `https://hzkpqfitsxnxcdefkqwt.supabase.co`
- Backend API: `https://moviespaces.onrender.com`
- Site: `https://moviespaces.org` · tester checklist at `/test`
- Ship command: `npm run ship` (local build → TestFlight submit)
- Admin seeds: header `x-admin-secret` (value = Render `CineMind__AdminSecret`)

Legend: `[ ]` todo · `[x]` done · `[~]` needs verify

## PHASE 1 — Deploy & data (an hour, gates everything)
- [x] All code merged to `main` (through the mixed-mystery/TV-catalog batch, 2026‑09‑04)
- [~] Render deploy of that merge finished — verify via the seed-tv response
      (`total: 72` = new code; ~30 = still deploying) and the boot log
      (a failed EF migration now aborts boot on purpose)
- [x] Supabase hand-applied migrations — owner confirmed all three ran:
      `20260825_profile_taste`, `20260829_blocks_and_friendship_hardening`,
      `20260902_blocked_peers_fn`
- [ ] Hand-apply `20260904_chat_requires_confirmed.sql` (chat needs a
      confirmed RSVP on hosted Spaces — enforced in RLS, not just the UI)
- [ ] Seed, in order (curl commands in session notes / above). Re-runs now
      skip already-seeded rows (add `?refresh=true` to force a full refetch):
      1. `POST /api/group/community-spaces/seed` (genre clubs)
      2. `POST /api/game/catalog/seed` → expect `total: 645`
      3. `POST /api/game/catalog/seed-tv` → expect `total: ~370`, `failed: 0`
- [ ] Delete `matchtest-{a,b,c}-0822@moviespaces.org` from Supabase Auth
- [ ] Flip **email confirmation ON** (Supabase → Auth → Providers → Email);
      the app handles both states
- [ ] Feedback pipeline env vars on Render (site notes → email):
      `Resend__ApiKey` (+ optional `Feedback__To`); CORS for the site is now
      baked into code, no env var needed

## PHASE 2 — Build → TestFlight
- [ ] `npm run ship` (does: local production build → `eas submit`)
- [ ] Build appears in TestFlight; install on the real phone
- [ ] Cold-launch sanity: name/icon/font right, no crash, Sentry shows the session
- [ ] AFTER the new build is broadly installed (not before): set Render env
      `CineMind__TvMysteryEnabled=true` — until then TV mysteries stay off
      because pre-update builds can't answer them (movie-only autocomplete)

## PHASE 3 — Device QA (the real gate; ~1–2 evenings, needs a second account)
Run `moviespaces.org/test` end to end (33 flows, ~30 min), then this
new-code addendum — none of it has ever been human-tested:
- [ ] Onboarding: genres → taste (keyboard never covers search) → tour →
      clubs & crews (Continue is PINNED, no scrolling needed) → land Home;
      **swipe-back cannot re-enter onboarding**; force-quit mid-tour doesn't
      replay onboarding
- [ ] Profile sheet: tap a crew seat / chat avatar / feed host → sheet shows
      top-3 & bottom-3; Add Friend → Requested; Message when friends;
      **long-press on a chat avatar still opens Report/Block**
- [ ] Crews: start one (real showing), second account joins from Home feed
      card (seat count right), "Wrong film or poster?" re-pick returns to
      confirm with the showing intact
- [ ] Clubs & Crews Discover: search, every chip, Near me distances, Preview,
      create a local club, rename it
- [ ] Group page: bubbles (Invite/Directions/Chat/Calendar) sit under the
      date block with the space code beneath; ticket toggle reads prominent
- [ ] Hosted Space: unconfirmed member sees "confirm to unlock chat";
      confirming unlocks it; tapping a chat PUSH while unconfirmed shows an
      empty chat whose sends fail with retry (server-enforced), not messages
- [ ] CineMind: four challenges, mystery is pick-from-six; share link shows
      no Mystery TV row and correct /400 (TV-mystery days are OFF until the
      Phase-2 env flip)
- [ ] Blocks: block second account → they vanish both ways (chats, badges,
      recently met, profile sheets), can't re-request
- [ ] Push: tap a chat push with app closed → lands in that chat; sign out →
      pushes stop
- [ ] Ugly pass: airplane mode (Retry states, not fake-empty), cold-start
      location indoors, largest text size, delete a throwaway account
- [ ] SSO on the TestFlight build: Apple + Google round-trip

## PHASE 4 — App Store Connect
- [ ] Screenshots (6.7" required; capture from the real build)
- [ ] Description + keywords + support URL (`moviespaces.org/support`) +
      marketing URL (`moviespaces.org`) — already live
- [ ] Privacy labels: account info, user content, location (when-in-use),
      identifiers; data linked to user
- [ ] Demo account for the reviewer (fresh, pre-onboarded past email confirm)
- [ ] Review notes: explain stranger matching (crews cap at 6, chat opens on
      join), UGC moderation (block/report both enforced server-side),
      self-reported tickets (no payments in-app), showtimes via Google links
- [ ] Age rating questionnaire · price: Free · availability: US

## PHASE 5 — Submit & react
- [ ] Submit for review; budget one rejection-fix cycle as normal
- [ ] While waiting: watch Sentry + `moviespaces.dev@gmail.com` (app feedback
      + site checklist notes land there)
- [ ] On approval: release, then tell the beta testers first

## Parked post-launch (see POST_LAUNCH.md)
Backend-declared club `kind` (replace client heuristic) · chat history paging ·
club→crew genre filtering · Fandango/CJ affiliate rework · Android · grow TV
catalog further · club-page "crews forming" strip
