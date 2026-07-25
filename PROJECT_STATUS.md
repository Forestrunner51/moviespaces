# MovieSpaces — Technical Product Status & Launch Plan

**Owner:** solo dev · **Target ship date:** **2026‑08‑31** (App Store, iOS) · **Status doc date:** 2026‑07‑24
**Companion doc:** `LAUNCH_CHECKLIST.md` (tactical, tick-through). This doc is the architectural + PM view.

---

## 1. Executive read

The product is **feature-complete for a v1** and the code is in good shape (typechecks clean, backend builds clean, lint at 0 errors). It has already reached **TestFlight**, so the build/submit pipeline is proven. **The remaining work to Aug 31 is almost entirely non-engineering:** external dashboard config, a fresh build that includes the latest native changes, a QA pass, App Store Connect metadata, and surviving App Review.

**Verdict: Aug 31 is achievable but requires discipline.** The two things that would blow the date are (a) feature creep and (b) leaving App Review to the last week. **Submit by ~Aug 15**, freeze scope now.

---

## 2. Architecture (what we're actually shipping)

**Client** — Expo SDK 56 / React Native 0.85 / expo-router (file-based routing) / TypeScript. Single fixed dark "cosmic" theme. 15 screens.

**Two independent backends** (this is the defining architectural trait — a split data model):

| System | Owns | Access | Notes |
|---|---|---|---|
| **Supabase** (`hzkpqfitsxnxcdefkqwt`) | Auth (email + Google/Apple), `profiles`, `friendships`, `messages` (DMs), `group_messages` (chat), `group_message_reads`, `reports`, `blocks`, avatar storage | Client → supabase-js directly, gated by **RLS** | PKCE flow; JWT is the shared identity |
| **.NET 10 API on Render** (`moviespaces.onrender.com`, separate Postgres via EF Core) | `Groups` (= "Spaces", the core entity), `GroupMembers`, `PushTokens`, `ShowtimeCache` (SerpApi showtime cache), `MovieSpace` (legacy/unused) | Client → REST, JWT-auth validated against Supabase JWKS | Also proxies TMDb + Google Places + **SerpApi** (hides keys), sends Expo Push, runs a reminder background service |

**Key coupling to be aware of:** a Space lives in the **.NET** DB, but its **chat lives in Supabase**. They're linked by the Supabase user id (stored as `text` on the EF side). Group-chat membership is enforced by a Supabase RLS function (`is_group_message_member`) that reads the **EF-owned** `"Groups"`/`"GroupMembers"` tables directly. → Both databases must point at the same logical data, and that RLS function is a cross-system dependency. Not a blocker, but the part most likely to bite if the two DBs ever drift.

**Third-party:** TMDb (movie/TV search + posters), Google Places (theaters/venues), **SerpApi** (Google showtimes — cached in Postgres, host-triggered), Expo Push (notifications), Sentry (wired but **disabled**).

**Backend endpoints (proven):** GroupController (create/get/search/open/mine, join, join-web, confirm/unconfirm, book/unbook, cancel, delete, transfer, leave, booking-url, report-showtime, notify-message, AASA), AccountController (delete account + cascade), LocationsController (nearby-theaters), TmdbController (search/search-tv/now-playing), **ShowtimesController (`GET /api/v1/showtimes` — SerpApi proxy, 6h Postgres cache)**, PushTokensController (register).

---

## 3. Feature inventory — WHAT WE HAVE  ✅

Status: ✅ built & working · ⚠️ built but unverified/needs config · 🔨 partial

**Auth & identity**
- ✅ Email/password signup + login
- ⚠️ Google SSO — code complete, **needs dashboard config + fresh build** to work
- ⚠️ Apple SSO — code complete, **needs App ID capability + Supabase config + fresh build**
- ✅ Password reset (in-app OTP flow) — ⚠️ needs Supabase email template `{{ .Token }}`
- ✅ Account deletion (client + full cascade across both DBs)
- ✅ Deep-link capture → return to intended screen after login
- ✅ Email confirmation — signup now handles ON *and* OFF in code ("check your email" state). Only the Supabase ON/OFF setting decision remains (recommend ON).

**Core "Spaces" product**
- ✅ Create MovieSpace (TMDb movie/TV search, Google Places theater picker, date/time, poster)
- ⚠️ Showtime autofill — host taps "Find Showtimes" → real SerpApi showtimes for the chosen film+theater → tap a slot to auto-fill time (+ booking URL when SerpApi provides one). **Needs `SerpApi:ApiKey` on Render + the `AddShowtimeCache` migration applied to prod.**
- ✅ Create Watch Party / private rental (cost split, capacity, venue link, activity types)
- ✅ Join a Space (app + web-name paths), capacity/status enforced server-side
- ✅ RSVP confirm/cancel (self-service; host implicit)
- ✅ Host lifecycle: Mark Booked / Unbook / Cancel / Delete / Transfer ownership
- ✅ Past-event lockdown (locks to chat-only after the event)
- ✅ Explore feed w/ filters (type, price, distance, chain, activity, availability) + collapsible filter UI
- ✅ Movie posters throughout (hero on detail, thumbnails on cards) — new `poster_path` column
- ✅ Home carousels (Upcoming Spaces + TMDb Popular in Theaters)

**Social**
- ✅ Friends (search by name/@username, request/accept/decline, sorted, live filter)
- ✅ Group chat (per-Space, polling-based, optimistic send, block-filtered)
- ✅ Direct messages (friends-only, RLS-enforced)
- ✅ Profiles (display name, unique @username, avatar upload, theater memberships, friend count)
- ✅ Add-friend from member lists & chat

**Trust & safety (Apple UGC requirements)**
- ✅ Report content (messages, spaces, users)
- ✅ Block users (hides their content)
- ✅ Sign in with Apple offered (required since Google offered)
- ✅ Account deletion

**Platform**
- ✅ Push notifications (booking, cancel, new-message, "starting soon" reminder via background service)
- ✅ Add to Calendar, Get Tickets (external Fandango/affiliate handoff — no in-app payments)
- ✅ Universal links + custom scheme (`moviespaces://`, AASA served)
- ✅ Legal: Terms + Privacy screens (content drafted)
- ✅ Display font (Bebas Neue) + semantic color roles + WCAG-AA contrast pass

---

## 4. WHAT'S PENDING  ⏳  (grouped by type, not feature)

### A. Native rebuild-gated (only real once a fresh production build ships)
- [ ] Fresh `production` build that includes: Apple/Google SSO, "MovieSpaces" name, Bebas Neue font, `react-native-get-random-values`. **Confirm the current TestFlight build has these — if it predates them, rebuild.**

### B. External config (no code, but features are dead until done)
- [ ] Supabase redirect URL `moviespaces://auth/callback`
- [ ] Google Cloud OAuth Web client + secret → Supabase Google provider
- [ ] Apple "Sign in with Apple" capability on App ID → Supabase Apple provider (bundle ID allow-list)
- [ ] Supabase Reset Password email template → `{{ .Token }}`
- [ ] Email confirmation ON/OFF decision — recommend **ON**. Code already handles both (done), so this is now just a dashboard toggle.
- [ ] Render prod env vars verified: `Tmdb:ApiKey`, `GooglePlaces:ApiKey`, `SerpApi:ApiKey` (new — showtimes), `Supabase:ServiceRoleKey`, `Supabase:Url`, `PostgresConnection`
- [ ] All Supabase migrations applied to prod DB (through `20260722_dm_friends_only`)
- [ ] EF `AddShowtimeCache` migration applied to the .NET prod DB (auto-migrates on boot — confirm the `ShowtimeCaches` table exists after deploy)

### C. Observability / production hardening
- [ ] Enable Sentry: set `EXPO_PUBLIC_SENTRY_DSN`, enable source-map upload (currently `SENTRY_DISABLE_AUTO_UPLOAD=true` everywhere) — **you have no crash visibility as configured**
- [ ] Render cold-start: free tier sleeps → first request after idle is slow. Decide: paid always-on instance vs accept it (client already has `authFetchWithTimeout`)

### D. QA (a real pass on a fresh build) — see LAUNCH_CHECKLIST Phase 4
- [ ] End-to-end: signup → create → join → RSVP → chat → friends → DM → explore → deep link → push → delete account, across **two accounts** on a **real device**

### E. App Store Connect submission assets — see LAUNCH_CHECKLIST Phase 5
- [ ] Screenshots (6.7" required), description, keywords, subtitle, category
- [ ] **App Privacy nutrition labels** — must disclose: email, name, photos, **precise location**, user content, usage data (Sentry). Apple cross-checks against behavior. *(Note: SerpApi is called server-side only — the app sends movie title + theater name to our backend, not the user's identity/location to SerpApi — so it doesn't add a new client-side data-collection category, but keep it in mind if the labeling asks about third-party sharing.)*
- [ ] Support URL + Privacy Policy URL (publicly hosted)
- [ ] Age rating (UGC/social → likely 12+/17+)
- [ ] Demo account credentials in review notes (reviewers must be able to log in)

### F. Legal review
- [x] Terms + Privacy updated for accuracy (now cover DMs, friend connections, SSO providers) and Apple 1.2 (zero-tolerance + 24h action statement) — done in `legal.ts`
- [ ] Optional: lawyer's read before scaling (not a launch blocker for v1)

---

## 5. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **App Review rejection** (metadata/privacy/demo login) | High (first submit) | Blows date if late | Submit by ~Aug 15; nail privacy labels; provide working demo login |
| **Feature creep** eats runway | High (pattern in recent sessions) | Slip to Sept | **Scope freeze now** — bugs/blockers only |
| SSO config chain incomplete at submit | Medium | SSO ships broken | Do Phase 2 config early, test on the fresh build |
| Split-DB drift (Supabase vs .NET) | Low | Chat/membership breaks | Both DBs already live & linked; don't re-point either |
| Render cold-start looks like "app is broken" to new users | Medium | Bad first impression | Consider always-on instance for launch week |
| No crash visibility at launch | Medium | Blind to prod bugs | Turn on Sentry before submit |
| Stale-bundle "bugs" waste dev time | Medium | Time sink | `expo start -c` + full relaunch when JS looks wrong |

---

## 6. Plan to Aug 31 (5.5 weeks)

- **Wk 1 (now–Aug 1):** Scope freeze. Do all Phase 2 external config. Turn on Sentry. Cut a fresh `production` build with current code → TestFlight. Verify SSO + name + font on-device.
- **Wk 2 (Aug 2–8):** Full QA pass on the fresh build (two accounts, real device). Fix blockers only. Confirm Render prod env + migrations. Draft App Store listing + take screenshots.
- **Wk 3 (Aug 9–15):** Finalize privacy labels, metadata, legal read. **Submit to App Review by ~Aug 15.** Provide demo login.
- **Wk 4 (Aug 16–22):** Handle rejection/resubmit (assume ≥1 cycle). Prep launch-city seed Spaces.
- **Wk 5 (Aug 23–31):** Approval → release. Seed content. Watch Sentry. Buffer.

**Critical path:** fresh build → QA → submit. Everything else parallelizes. If it isn't submitted by ~Aug 20, Aug 31 is at serious risk.

---

## 7. Explicitly OUT of scope for v1 (park for v1.1)
Community Activity Feed · genre chips · richer theme redesign · hero-poster redesigns · Android launch · in-app payments/ticketing · any new feature. **If it's not a bug or a launch-blocker, it waits.**
