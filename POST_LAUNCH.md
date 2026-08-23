# MovieSpaces — Post-Launch / v1.1+ Ideas

Parked here so they don't get lost. **Scope is frozen for launch** (bugs and
blockers only) — nothing below is built until the app is live and has real
users. Captured 2026-08-21.

## The through-line
All of these point at one thing: turn the community layer from a handful of
**hardcoded, global, genre** clubs into a **living, user-driven, local +
interest-based** community. That's better aligned with what the app is (people
meeting up for movies, in person, locally) than the current setup — but every
piece of it needs the two things a launched app doesn't have yet: **local user
density** and a **safety/moderation story for connecting strangers**. Build it
*against real usage*, not guesses.

## Ranked by readiness

### 1. Choose popular clubs at signup — SMALL (near-done)
Onboarding already shows joinable community clubs (`onboarding-interests.tsx`
→ `space-discovery.tsx`) based on genre picks. Gap is just sorting/labeling by
**popularity** (member count / activity). Low-risk enhancement, good first
v1.1 item.

### 2. User-created community clubs — BUILT 2026‑08‑22 (`create-club.tsx`)
Anyone can create a public club (cap 5 per user). Still owed post-launch:
a moderation story specific to user-created clubs (report → remove a club,
not just its messages).

### 3. Location-based clubs (Strava-style) — LARGE (gated on density)
Scope clubs to areas — "Dallas Horror", clubs near you, **local** CineMind
leaderboards (local competition beats a global one). Fits the app's local-
meetup core. Needs enough users per area or "clubs near you" is empty for
almost everyone. v2.

### 4. Match mode — BUILT 2026‑08‑22/23 as "Movie Crew" (see PROJECT_STATUS §3b)
Shipped in v1 after all: crews keyed on the specific showing, capped at 6,
reusing block/report. What's still post-launch here:
- **Ticket-holder anchoring** — a ticket-holder's showing becomes the crew's
  plan and others buy into it; today the self-reported "ticket in hand" flag
  is the only commitment signal (no gating, by decision).
- **Seat race** under concurrent taps (two people tapping within one
  round-trip can over-fill a crew or spawn two crews for one showing) — needs
  a unique index or a transaction; same class as the existing `JoinGroup`.
- **Density tooling** — seed crews for current releases in launch cities so
  the first real users land in a crew, not alone.
- **Home + Explore merge** into a 4-tab layout (decision pending on device).

## Cross-cutting notes
- **Density first.** #3 and #4 are the *reward* for having users, not the way
  to get them. They read as broken when empty.
- **Safety is not optional** for anything that connects strangers for in-person
  meetups — design the moderation model before the feature.
- Sequence: ship → (1) club-picker polish → (2) user-created clubs + moderation
  → (3)/(4) local + matching once density and time allow.
