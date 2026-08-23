# MovieSpaces — Technical Product Status & Launch Plan

**Owner:** solo dev · **Status doc date:** 2026‑08‑08, refreshed 2026‑08‑23 · **Goal: ship to the App Store and be done.**
**Companion doc:** `LAUNCH_CHECKLIST.md` (tactical, tick-through). This doc is the architectural + PM view.

> Written to be read cold by a new session. The previous version of this doc was dated 2026‑07‑24 and was badly stale — treat anything not in this file as unverified.

---

## 1. Executive read

Feature-complete for v1. Typecheck clean, lint 0 errors, **52 backend tests passing**. **But: `feature/pushingdata` is ~25 commits ahead of `main`, and Render runs `main`** — nothing from 2026‑08‑22/23 is in production until it's merged. Two EF migrations (`AddMatchMovieKeyToGroups`, `AddHasTicketToGroupMembers`) apply automatically on the next backend boot.

**The app's story is meeting new people over movies** — not coordinating with friends you already have. That framing (corrected by the owner 2026‑08‑22) is why the 08‑22/23 work happened: **Movie Crew** (pick a showing, get grouped with up to 5 strangers going to it), user-created clubs, a Home that leads with a feed of people going to things, and a "you've got plans" card. See §3.

**The remaining work is non-engineering:** merge + deploy, a real-device QA pass over the new flows, a fresh EAS build, App Store Connect metadata, and surviving App Review. Full list in §4 and `LAUNCH_CHECKLIST.md`.

**Scope is frozen again as of 2026‑08‑23.** The 08‑22/23 additions were a deliberate exception to the 08‑07 freeze (the owner judged the stranger-matching layer core to the pitch, not a tangent). From here: bugs and launch blockers only. Two pivots (persona-generator, quest/XP) were rejected 08‑07 and live in `../LARP`, `../LarpQuest`.

**Honest read on prospects:** Movie Crew needs user density to feel alive (a crew of one is the empty-room problem); the flow is built so a solo crew is still a real, joinable plan with a showing. CineMind competes with free browser trivia. The owner knows and chose to ship. Don't relitigate it.

---

## 2. Architecture

**Client** — Expo SDK 56 / React Native 0.85 / expo-router / TypeScript strict. Single fixed dark "cosmic" theme. ~15 screens.

**Two backends** (the defining architectural trait — a split data model):

| System | Owns | Access |
|---|---|---|
| **Supabase** (`hzkpqfitsxnxcdefkqwt`) | Auth (email + Google/Apple), `profiles`, `friendships`, `messages` (DMs), `group_messages`, `group_message_reads`, `reports`, `blocks`, avatar storage | Client → supabase-js directly, gated by RLS |
| **.NET 10 API on Render** (`moviespaces.onrender.com`, separate Postgres via EF Core) | `Groups` (= "Spaces"), `GroupMembers`, `PushTokens`, CineMind tables (`CineMindMovies`, `CineMindTvShows`, `DailyPuzzles`, `UserDailyProgress`, `RouletteSpinHistory`) | Client → REST, JWT validated against Supabase JWKS |

**Key coupling:** a Space lives in the .NET DB, its chat lives in Supabase, linked by Supabase user id. Group-chat membership is enforced by a Supabase RLS function reading the **EF-owned** tables. Both DBs must point at the same logical data — the part most likely to bite if they ever drift.

**Third-party:** OMDb (movies/TV, no popularity endpoint → curated IMDb-id catalog), Google Places (theaters), Expo Push, Sentry (now live, see §3), Resend (transactional email via custom SMTP).

**Showtimes are not an API.** "Find Showtimes Near Me" deep-links to a Google showtimes search. The host reads the real time off Google, sets it in the picker, and optionally pastes the exact Fandango URL into the "Exact Ticket Link" field so "Get Tickets" goes straight there.

---

## 3. What changed recently (2026‑08‑05 → 08‑08)

Everything here is committed on `main` and deployed unless noted.

**Bugs fixed (all found by review or tests, several were live in production):**
- **CineMind 500 on `/puzzles/today`** — repeat-avoidance code read past days' stored puzzle JSON and dereferenced fields that didn't exist in older payloads. `System.Text.Json` fills a missing property with null rather than throwing, so old rows parsed "successfully" but incomplete.
- **The fix for that was itself a no-op**, caught by a test: `SchemaVersion` defaulted to `CurrentSchemaVersion`, and STJ substitutes the C# default for a missing property — so every legacy row read as "current" and the check never fired. Now defaults to an `UntaggedSchemaVersion` sentinel.
- **Roulette genre filter silently mixed genres** — picked one random film from the genre, then built the challenge from the *whole* catalog. Now iterates every film in-genre and never widens.
- **"Get Tickets" could never resolve to a real showtime** — `bookingUrl` was settable only for `private_rental`, but the Tickets button only shows for `public_gathering`. Structurally unreachable. Now settable at creation and post-creation for public gatherings.
- **3 regressions from the length-cap migration** — `EditGroup`, `UpdateBookingUrl`, `JoinGroup` wrote to newly-`varchar(n)` columns with no validation → `DbUpdateException` → unhandled 500. All now use a shared `CheckLength`.
- `withAffiliateTag` appended the tracking param after a URL fragment, corrupting it (dormant — no affiliate tag set — but newly reachable via pasted Fandango URLs).

**Hardening:**
- **CORS locked** to explicit origins (was `AllowAnyOrigin()`). Verified live in production via curl.
- **Pollers gated to foreground** (`use-foreground-poll.ts`) — 6 pollers were running while backgrounded.
- **42-test xUnit suite** (`src/backend/backend.Tests`) — payload schema-versioning, answer redaction, scoring invariants. Pure logic, no infra needed.
- **Length caps** on all host-supplied text + Kestrel 256KB body limit.
- **`guest-join` rate limit** (30/min) on the anonymous join endpoint.
- **Accessibility** — 8 icon-only controls labeled (the real gap; RN already exposes `<Text>` children).
- **`Alert.alert` → toast** for 54 of 62 sites; 8 genuine confirmations correctly kept as blocking modals.
- **`JwtSecret` removed** from `appsettings.json` (was committed, unread by code).

**Infrastructure now done:**
- **Sentry fully wired** — client DSN in `eas.json` production, backend DSN as `Sentry__Dsn` on Render, `SENTRY_AUTH_TOKEN` in EAS project secrets (verified via `eas secret:list`), source-map upload enabled for production only.
- **Custom SMTP via Resend** — domain `moviespaces.org` bought and verified (DKIM/SPF/DMARC in Cloudflare). Supabase now sends auth email through it instead of the throttled default sender.
- **Google SSO verified** working at the provider level (tested the Supabase authorize URL directly in a browser).
- **`main` caught up** — was 118 commits behind `feature/pushingdata`, meaning none of this was deployed. Merged via PR #105. Backend redeploy confirmed live.
- **Catalog re-seeded** (~45 films added for Roulette genre coverage + `surprise_me` flags).

---

## 3b. What changed 2026‑08‑22 → 08‑23 (all on `feature/pushingdata`, NOT yet deployed)

**Movie Crew (match mode)** — `POST /api/group/match`, `GET /api/group/match/open`, `POST /{id}/ticket`. Flow: kind (theater / venue) → film → crews already forming for it (join one) → or pick a real showing (`ShowtimePicker` filtered to the film; venue crews name a place + date/time) → crew is created *with* a plan. Crews cap at 6, are keyed `theater:imdb:tt…` / `venue:…`, converge on identical theater showings (never on venue name — "Home, 8 PM" in two cities is two plans), close once their showtime passes, and any seated member can set the where/when (`EditGroup`; film/capacity are locked for crews). Self-reported "ticket in hand" flag + theater-membership badges (AMC A-List etc., already on profiles) per member. Ship decision: **don't gate on ticket ownership** — commitment is visible, not required.

**UI** — Karla body face app-wide (Bebas stays for dates/labels). Home: rotating headline → Movie Crew hero → host cards → "Happening near you" as a person-led feed ("Bob is seeing Mutiny · Tonight", "I'm in" joins on the spot). My Spaces: "You've got plans." next-up card above the list. Group page: joined/created celebration card, crew seats with faces + ticket checks. Profile: stat row (films seen · crews · upcoming · CineMind streak). Persistent "Find a crew" FAB on Explore / My Spaces / Profile. A full "de-AI" pass (no emoji/discs/kickers) was tried and **reverted** at the owner's request — it read flat; keep the accents.

**Bugs fixed (found by two code-review passes + live testing):** join path 500'd (EF tracked-entity/Modified); members of a full crew re-seated into a twin; stale crews absorbing matchers; crew members could retitle/resize a crew; push attribution wrong for member edits; `ShowDate/ShowTime` unchecked → varchar 500; search with no debounce; renamed users seated under signup names; SSO signups skipping onboarding; **font-scaling cap was a no-op under React 19** (`Text.defaultProps` does nothing — now a wrapper `components/scaled-text.tsx` every screen imports; verified at max accessibility size).

**Infra gotchas learned:** a stale Metro holding 8081 serves an old bundle and `expo start -c` silently fails to bind; without `watchman` Metro's watcher misses edits — restart `expo start -c` to see changes; `npm audit fix --force` downgraded Expo 56 → 46 once (restored from the lockfile; never run it).

## 4. What's still owed

**First (20 minutes):**
- [ ] **Merge `feature/pushingdata` → `main`** and confirm the Render deploy restarted (migrations apply on boot; check logs for `AddHasTicketToGroupMembers`).
- [ ] Delete the three `matchtest-{a,b,c}-0822@moviespaces.org` test accounts from Supabase Auth.
- [ ] `brew install watchman`.

**Decisions:**
- [ ] Home + Explore merge into 4 tabs (Home absorbs Explore's search/filters; My Spaces → "My Plans" with a badge), or keep 5. Judge from the device.
- [ ] Fandango affiliate (Impact): apply now; it's a config value, not code.

**Blocking the build:**
- [x] **Rotate the Supabase `JwtSecret`** — DONE 2026‑08‑17. Migrated to asymmetric JWT signing keys + new API keys (`sb_publishable_`/`sb_secret_`); legacy anon/service_role keys disabled and the legacy secret revoked. Verified externally: a forged `service_role` token signed with the leaked secret (`15a1a5d5-…`, recovered from git history) is now rejected 401 by REST, the legacy key is out of JWKS, and the new keys work end‑to‑end (login, backend JWT validation, account deletion via Render). The value remains in git history but is now inert.
- [x] `moviespaces://auth/callback` in Supabase → Auth → URL Configuration → Redirect URLs — entered 2026‑08‑16; final proof is SSO round-tripping on the real build
- [x] Reset-password email template → shows `{{ .Token }}` as visible text (updated 2026‑08‑16; test recovery email sent same day — confirm the code is visible in it). Context: **the app has no screen that handles a reset *link*** — `reset-password.tsx` calls `verifyOtp({ type: "recovery" })` and expects a typed code, so the default link-based template was broken for this app.
- [ ] Email confirmation ON/OFF decision (code handles both; recommend ON). Currently **OFF** (Supabase `mailer_autoconfirm: true`, confirmed 2026‑08‑18) — one toggle to flip.
- [x] **Both SSO providers verified working 2026‑08‑18** on a local dev build (`npx expo run:ios`, NOT Expo Go). Google needed a **Web**-type Google Cloud OAuth client + its Client Secret in Supabase (an iOS-type client has no secret → the "Unable to exchange external code" failure). Apple needed **`ios.usesAppleSignIn: true`** in `app.json` — the `expo-apple-authentication` plugin alone did NOT add the `com.apple.developer.applesignin` entitlement, so Apple failed with AuthorizationError 1000 until that flag was set and the app rebuilt. `showSso` is now `true`. Only the TestFlight round-trip remains to seal it.

**Fixed since the 08‑08 doc (all committed to `feature/pushingdata`, deployed on Render):**
- Showtimes scraper produced no data since 08‑14 — root cause was `Showtimes__Cities` set to the bogus value `15` (→ 404 on the directory fetch). Reset to `dallas-tx`; scrape works again. A verified 45-metro slug list exists for post‑launch expansion.
- Sentry structured **Logs** enabled (client + backend); EF per‑statement SQL logging dropped to Warning so it doesn't flood the log quota.
- The recurring `DbUpdateException` flood was the CineMind first‑seen insert racing on parallel puzzle fetches — fixed with an atomic `INSERT … ON CONFLICT DO NOTHING`.
- CineMind Mystery: plot now shown from the first clue; tries cut to easy 3 / medium 2 / hard 1 to compensate. Roulette practice now draws wrong‑answer options from the full catalog (was genre‑limited/repetitive).

**The actual gate:**
- [ ] **Fresh `eas build --platform ios --profile production`** → TestFlight. SSO is now proven on a dev build, so this is safe to spend. Note: Expo Go **cannot** test SSO — custom URL scheme + native module both require a real build (`expo run:ios` dev build or the production build).
- [ ] **Real-device QA pass, two accounts.** Full checklist in `LAUNCH_CHECKLIST.md` Phase 4 (new 4b section for the 08‑22/23 flows). None of Movie Crew, the feed "I'm in", the celebration, ticket toggle or the stat row has been used end-to-end by a human on a phone yet.

**App Store Connect:**
- [ ] Screenshots (6.7" required), description, subtitle, keywords, category
- [ ] **App Privacy nutrition labels** — must disclose email, name, photos, precise location, user content, usage data (Sentry). Apple cross-checks against behavior.
- [ ] Support URL + publicly hosted Privacy Policy URL
- [ ] Age rating (UGC + messaging → likely 12+/17+)
- [ ] **Demo account with real content** in review notes — most common rejection cause for login-gated apps
- [ ] Review notes must now describe **Movie Crew** (the app groups strangers for in-person meetups): crew size capped at 6, block/report on every member and chat, self-reported ticket flag only. Apple will ask.

**Non-blocking:**
- [x] Render cold-start decision — web service upgraded to Starter ($7/mo, always-on) 2026‑08‑16; also makes the nightly showtimes scrape reliable
- [ ] Delete the inert `Sentry__AuthToken` env var from Render (backend never reads it)

---

## 5. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| App Review rejection (metadata/privacy/demo login) | High on first submit | Nail privacy labels; working demo account; budget ≥1 resubmit cycle |
| Apple SSO broken in the real build | Low | **Verified working on a local dev build 2026‑08‑18** (entitlement added via `ios.usesAppleSignIn`). Only the TestFlight round-trip remains; `showSso` can still be flipped to `false` if it regresses |
| Split-DB drift (Supabase vs .NET) | Low | Both live and linked; don't re-point either |
| Render cold-start looks like a broken app | Resolved | Upgraded to always-on Starter instance 2026‑08‑16 |
| Regression from a schema change | Medium | Has happened twice. Enumerate every write path before changing a column's shape |

---

## 6. Explicitly OUT of scope
Android launch (Karla `fontWeight` would need the explicit-family pass) · in-app payments / any monetization (decided 2026‑08‑22: ship without; affiliate tag is config only) · seat-race hardening under concurrent taps (same class as existing `JoinGroup`; post-launch) · ticket-holder gating · **any new feature**. If it's not a bug or a launch blocker, it waits.

---

## 7. Commands

```bash
npm run check    # tsc --noEmit + expo lint + dotnet test (42) — no infra needed
npx tsc --noEmit
npx expo lint
dotnet test src/backend/Moviespaces.slnx
```

Lint sits at **0 errors / 15 warnings**. The warnings are pre-existing `set-state-in-effect` patterns, deliberately downgraded from errors in `eslint.config.js` — see that file's comment. Don't "fix" them as busywork.
