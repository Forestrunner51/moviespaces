# MovieSpaces — Technical Product Status & Launch Plan

**Owner:** solo dev · **Status doc date:** 2026‑08‑08 · **Goal: ship to the App Store and be done.**
**Companion doc:** `LAUNCH_CHECKLIST.md` (tactical, tick-through). This doc is the architectural + PM view.

> Written to be read cold by a new session. The previous version of this doc was dated 2026‑07‑24 and was badly stale — treat anything not in this file as unverified.

---

## 1. Executive read

Feature-complete for v1 and hardened well past where it was two weeks ago. Typecheck clean, lint 0 errors, **42 backend tests passing**, backend deployed and verified live.

**The remaining work is almost entirely non-engineering:** a fresh EAS build, a real-device QA pass, App Store Connect metadata, and surviving App Review. The one code-adjacent thing left is fixing whatever that QA pass surfaces.

**Scope is frozen.** Decision made 2026‑08‑07 after considering (and rejecting) two pivots — a persona-generator app and a quest/XP app, both of which now live in separate repos (`../LARP`, `../LarpQuest`). MovieSpaces ships as-is: Spaces, chat, friends, DMs, CineMind, Roulette. No new features.

**Honest read on prospects:** the cold-start problem (a coordination app needs your friends on it) and CineMind competing with free browser trivia games are real. The user knows this and chose to finish and ship anyway rather than leave it unfinished. Don't relitigate it.

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

## 4. What's still owed

**Blocking the build:**
- [x] **Rotate the Supabase `JwtSecret`** — DONE 2026‑08‑17. Migrated to asymmetric JWT signing keys + new API keys (`sb_publishable_`/`sb_secret_`); legacy anon/service_role keys disabled and the legacy secret revoked. Verified externally: a forged `service_role` token signed with the leaked secret (`15a1a5d5-…`, recovered from git history) is now rejected 401 by REST, the legacy key is out of JWKS, and the new keys work end‑to‑end (login, backend JWT validation, account deletion via Render). The value remains in git history but is now inert.
- [x] `moviespaces://auth/callback` in Supabase → Auth → URL Configuration → Redirect URLs — entered 2026‑08‑16; final proof is SSO round-tripping on the real build
- [x] Reset-password email template → shows `{{ .Token }}` as visible text (updated 2026‑08‑16; test recovery email sent same day — confirm the code is visible in it). Context: **the app has no screen that handles a reset *link*** — `reset-password.tsx` calls `verifyOtp({ type: "recovery" })` and expects a typed code, so the default link-based template was broken for this app.
- [ ] Email confirmation ON/OFF decision (code handles both; recommend ON)
- [ ] Apple SSO — App ID capability + Supabase provider config entered, but **unverifiable until a real build exists** (needs the native module; Expo Go can't test it)

**The actual gate:**
- [ ] **Fresh `eas build --platform ios --profile production`** → TestFlight. Everything above is unverified on a real device until this exists. Note: Expo Go **cannot** test Google or Apple SSO — custom URL scheme + native module both require a real build. This caused real confusion; don't repeat it.
- [ ] **Real-device QA pass, two accounts.** Full checklist in `LAUNCH_CHECKLIST.md` Phase 4. Pay specific attention to things never run once: the "Exact Ticket Link" flow, the toast rendering on screens with and without a native header, Roulette genre purity, CineMind repeat-avoidance.

**App Store Connect:**
- [ ] Screenshots (6.7" required), description, subtitle, keywords, category
- [ ] **App Privacy nutrition labels** — must disclose email, name, photos, precise location, user content, usage data (Sentry). Apple cross-checks against behavior.
- [ ] Support URL + publicly hosted Privacy Policy URL
- [ ] Age rating (UGC + messaging → likely 12+/17+)
- [ ] **Demo account with real content** in review notes — most common rejection cause for login-gated apps

**Non-blocking:**
- [x] Render cold-start decision — web service upgraded to Starter ($7/mo, always-on) 2026‑08‑16; also makes the nightly showtimes scrape reliable
- [ ] Delete the inert `Sentry__AuthToken` env var from Render (backend never reads it)

---

## 5. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| App Review rejection (metadata/privacy/demo login) | High on first submit | Nail privacy labels; working demo account; budget ≥1 resubmit cycle |
| **Apple SSO broken in the real build** | Medium | Config is entered but never tested. If it fails at QA, hide the button rather than ship it broken — a visibly broken auth button is a near-certain rejection |
| Split-DB drift (Supabase vs .NET) | Low | Both live and linked; don't re-point either |
| Render cold-start looks like a broken app | Resolved | Upgraded to always-on Starter instance 2026‑08‑16 |
| Regression from a schema change | Medium | Has happened twice. Enumerate every write path before changing a column's shape |

---

## 6. Explicitly OUT of scope
Community Activity Feed · genre chips · theme redesign · Android launch · in-app payments · removing the social layer · **any new feature**. If it's not a bug or a launch blocker, it waits.

---

## 7. Commands

```bash
npm run check    # tsc --noEmit + expo lint + dotnet test (42) — no infra needed
npx tsc --noEmit
npx expo lint
dotnet test src/backend/Moviespaces.slnx
```

Lint sits at **0 errors / 15 warnings**. The warnings are pre-existing `set-state-in-effect` patterns, deliberately downgraded from errors in `eslint.config.js` — see that file's comment. Don't "fix" them as busywork.
