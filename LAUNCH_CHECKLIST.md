# MovieSpaces — App Store Launch Checklist

Target: **App Store live by end of August 2026.**
Submit to review by **~mid-August** to leave buffer for a rejection cycle.

Key facts (fill/verify as you go):
- Bundle ID: `com.newfahrenheit45.Moviespaces`
- Apple Team ID: `8J48NY9S42`
- EAS project: `16d58e9a-1828-40c1-b2a2-34b37fc4fe20`
- Supabase project: `https://hzkpqfitsxnxcdefkqwt.supabase.co`
- Backend API: `https://moviespaces.onrender.com`
- OAuth callback (for Google/Apple in Supabase): `https://hzkpqfitsxnxcdefkqwt.supabase.co/auth/v1/callback`
- App deep-link scheme: `moviespaces://`

Legend: `[ ]` todo · `[x]` done · `[~]` in progress/needs verify

---

## PHASE 0 — Stabilize dev environment (do first, this week)
Nothing downstream matters until you can build → run → test a flow without fighting the toolchain.
- [ ] Get on a normal network (iPhone Personal Hotspot gives a `192.168.x` IP — avoids the CGNAT/ATS issue and the tunnel entirely)
- [ ] Confirm you can run the app on a real device or simulator and navigate all main screens
- [ ] `npx expo start -c` habit when JS behaves stale (several past "bugs" were stale bundles)
- [ ] If a new screen/card "doesn't appear", check `lsof -nP -iTCP:8081` — a days-old Metro holding the port serves the stale bundle and `expo start -c` silently fails to bind (bit us 2026-08-22)
- [ ] Local `npx expo run:ios` needs `SENTRY_DISABLE_AUTO_UPLOAD=true` (now in `.env`); without it the Sentry Xcode phase fails the build with "An organization ID or slug is required"

## PHASE 1 — First real (cloud) build → TestFlight  ← biggest milestone
Everything native only becomes real here: SSO, the "MovieSpaces" name, Bebas Neue font, crypto polyfill.
- [ ] `eas build --platform ios --profile production` (cloud — NOT `--local`; local needs Fastlane you don't have)
- [ ] Build succeeds and is signed with the distribution cert / provisioning profile
- [ ] `eas submit --platform ios` (or upload the .ipa) to App Store Connect → TestFlight
- [ ] Install via TestFlight on a real device; confirm the app launches and the name/font/icon are correct
- [~] Verify the native bits now work: Apple sign-in button appears, Google sign-in doesn't crash, signup/login work — **both SSO providers verified on a local dev build 2026‑08‑18** (`npx expo run:ios`); re-confirm on the TestFlight build

## PHASE 2 — Auth & dashboard config (unblocks SSO + password reset)
- [x] **Supabase → Auth → URL Configuration →** add redirect URL `moviespaces://auth/callback` — entered 2026‑08‑16; not externally verifiable, so it's truly proven only when SSO round-trips back into the app on the real build (Phase 2 test line below)
- [x] **Google Cloud Console →** OAuth 2.0 **Web** client with redirect URI `https://hzkpqfitsxnxcdefkqwt.supabase.co/auth/v1/callback` — done 2026‑08‑18. The earlier failure was an **iOS**-type client (no secret); a Web client fixed it.
- [x] **Supabase → Auth → Providers → Google →** Client ID + Secret pasted, enabled — verified end-to-end on the dev build 2026‑08‑18 (seamless sign-in).
- [x] **Apple "Sign in with Apple" capability** — added via `ios.usesAppleSignIn: true` in `app.json` (adds the `com.apple.developer.applesignin` entitlement; the plugin alone did not). Automatic signing registers it on the App ID. Verified on the dev build 2026‑08‑18.
- [x] **Supabase → Auth → Providers → Apple →** enabled (provider shows `apple: true`); verified round-tripping on the dev build 2026‑08‑18.
- [x] **Supabase → Auth → Email Templates → Reset Password →** surfaces the code via `{{ .Token }}` — updated 2026‑08‑16.
- [x] **Signup now handles email confirmation ON or OFF** in code (`auth.tsx` — shows "check your email" when a session isn't returned). No code change needed either way now.
- [ ] **Decide: email confirmation ON or OFF?** (Supabase → Auth → Providers → Email → "Confirm email") — recommend **ON** for launch (stops fake-email spam). Just flip the setting; the app already handles both.
- [ ] Test each: Google sign-in, Apple sign-in, email signup, email login, forgot-password end-to-end on a real build

## PHASE 3 — Backend / infra production readiness
- [x] **CORS locked to explicit origins** (`Program.cs`) — was `AllowAnyOrigin()`, meaning any page on the internet could call every endpoint and read the response. Mobile is unaffected (React Native sends no `Origin` header; CORS is browser-only). Override with `Cors__AllowedOrigins__0` if a web build is ever deployed.
- [x] **Pollers gated to foreground** (`use-foreground-poll.ts`) — chat/4s, Space/5s and three 15s pollers used to keep running while backgrounded, burning battery and hammering the single Render instance.
- [x] **Backend test suite added** (`src/backend/backend.Tests`, 42 tests) — run with `npm test`, or everything at once with `npm run check`. Covers payload schema-versioning, answer redaction, and scoring.
- [x] **Rotate the Supabase `JwtSecret`** — DONE 2026‑08‑17. Migrated to asymmetric signing keys + new API keys; legacy keys disabled and legacy secret revoked. Verified: a forged service_role token signed with the leaked secret now returns 401. `eas.json` + `.env` updated to the `sb_publishable_` key; Render `Supabase__ServiceRoleKey` updated to the `sb_secret_` key.
- [x] **`Sentry__Dsn` set on Render** (backend crash reporting live). Still confirm the rest are set: `Omdb__ApiKey`, `GooglePlaces__ApiKey`, `Supabase__ServiceRoleKey`, `Supabase__Url`, `PostgresConnection`, `CineMind__PuzzleSalt`, `CineMind__AdminSecret`. (`CineMind__AdminSecret` confirmed present — a wrong-secret request returns 401, not the 500 a blank one would.)
- [x] **Delete the inert `Sentry__AuthToken` env var from Render** if still there — the backend never reads it; the auth token belongs in EAS secrets, not Render.
- [x] **Catalog re-seeded** — `surprise_me` flags populated, ~45 films added for Roulette genre coverage.
- [ ] All Supabase migrations applied to the production DB (friends-only DM policy, reports/blocks, etc.). EF migrations auto-apply on backend boot — confirm the Render deploy actually restarted.
- [ ] Confirm the `AddGroupPosterPath` EF migration ran (poster feature) — the backend auto-migrates on boot
- [x] Render cold-start: **resolved 2026‑08‑16 — web service upgraded to Starter ($7/mo, always-on).** No more sleep/cold-start, and the nightly showtimes scrape can actually fire at its 9:00 UTC window (a sleeping free instance had no poll loop running). Can drop back to Free post-launch if desired.
- [x] **Sentry fully wired** — client DSN in `eas.json` production, backend DSN on Render, `SENTRY_AUTH_TOKEN` in EAS project secrets (verified via `eas secret:list`), `SENTRY_DISABLE_AUTO_UPLOAD=false` so production stack traces are readable rather than minified.
- [x] **Custom SMTP via Resend** — `moviespaces.org` bought + verified (DKIM/SPF/DMARC in Cloudflare). Supabase auth email no longer uses the throttled default sender.
- [x] **`main` merged and deployed** — was 118 commits behind; none of the recent work was live until PR #105. CORS lockdown verified live in production via curl.
- [ ] Load-sanity: nothing here needs to scale huge, but confirm the DB and API respond under a few concurrent users

## PHASE 4 — QA: test every flow on a real device
Run each end-to-end, signed-in as a real user:
- [ ] Sign up → onboarding → land in app
- [ ] Create a MovieSpace (movie search, theater picker, date/time, poster shows)
- [ ] Find Showtimes: pick a movie → "Find Showtimes Near Me" opens a Google showtimes search in the in-app browser (real local theaters/times/ticket links); host reads the time and sets it in the picker. No API to configure.
- [ ] Create a Watch Party / private rental (cost, capacity, venue link)
- [ ] Join a Space (as a different account) → RSVP confirm/cancel
- [ ] Group chat: send/receive, keyboard doesn't cover Send, no flicker
- [ ] Friends: search, request, accept, DM (friends-only), block/report
- [ ] Explore: filters, poster cards, join from Explore
- [ ] Deep link: open a shared `/space/{id}` link while logged out → lands right after login
- [ ] Push notifications: booking, cancel, reminder, new message
- [ ] Add to Calendar, Get Tickets handoff
- [ ] Host actions: Mark Booked, Hand Off Ownership, Cancel, Delete
- [ ] Past event → screen locks to chat-only
- [ ] Account deletion → account + data actually gone
- [ ] Report/Block a user → content hidden

## PHASE 5 — App Store Connect listing + assets
- [ ] App name, subtitle, keywords, category (Social Networking / Entertainment)
- [ ] Description + "What's New"
- [ ] Screenshots: 6.7" (required) + 6.5" + iPad if you support it — at least a few polished ones (home, explore, a Space, chat)
- [ ] App icon (1024×1024, no alpha)
- [ ] Support URL + Marketing URL (a simple landing page or even a Notion page works)
- [ ] Privacy Policy URL (must be publicly hosted, not just in-app)
- [ ] **App Privacy "nutrition labels"** — disclose everything you collect: email, name, photos, **precise location**, user content (messages/spaces), usage data (Sentry). Apple checks this against actual behavior.
- [ ] Age rating questionnaire (UGC + social → likely 12+/17+; be honest about user-generated content)
- [ ] Export compliance: `ITSAppUsesNonExemptEncryption: false` is already set in app.json ✓

## PHASE 6 — Legal / compliance (Apple checks these for social/UGC apps)
- [x] Sign in with Apple offered (required since you offer Google) — done in code
- [x] Account deletion in-app — done
- [x] Report + Block for user content — done
- [~] Terms of Service — content updated for accuracy + Apple 1.2 (`legal.ts`); still worth a lawyer's read before scaling
- [x] Privacy Policy — updated to truthfully list location, photos, email, group + **direct** messages, friend connections, and SSO providers (Apple/Google)
- [x] Location permission string is clear (app.json has "find nearby theaters") ✓
- [x] UGC "no tolerance for objectionable content" + prompt-action (24h) statement present in Terms (Apple 1.2)

## PHASE 7 — Submit & review
- [ ] Submit the build for review (aim mid-August)
- [ ] Provide a **demo account** in App Review notes (reviewers need to log in — give them a test email/password)
- [ ] Note in review: "third-party ticket links open externally; app does not process payments"
- [ ] Respond fast to any rejection — expect possibly 1 round; common hits: privacy labels mismatch, screenshots, demo login not working

## PHASE 8 — Launch & post-launch
- [ ] Release (manual or auto on approval)
- [ ] Watch Sentry for crashes in the first days
- [ ] Have a plan for OTA JS fixes (`eas update`) vs. what needs a rebuild
- [ ] Seed some Spaces in your launch city so the app isn't empty for first users (cold-start problem)

---

## SCOPE FREEZE
From now until launch: **bugs and launch-blockers only.** No new features, no redesigns. Every new thing added is runway spent. Park ideas in a "v1.1" list.

## Known open code items (decide before launch)
- [ ] Email-confirmation handling (see Phase 2) — code change if you turn confirmation ON
- [ ] Render cold-start UX — the app already has timeout handling (`authFetchWithTimeout`), but first-request-after-idle may feel slow
