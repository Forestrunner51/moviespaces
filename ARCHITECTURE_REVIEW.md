# MovieSpaces: Technical Architecture Review

**Prepared:** 2026-09-05 (updated the same day after the integration suite and Realtime chat landed; see the notes marked *Update*)
**Perspective:** senior full-stack engineer reviewing the system as built, on the eve of its App Store submission
**Sources:** the repository at commit `d6fe579` on `feature/pushingdata`, the checked-in status documents, the Supabase SQL migrations, and the .NET migrations. Every claim below was checked against code, not inferred from documentation.

---

## 1. Executive Summary

MovieSpaces is an iOS-first social app whose pitch is meeting strangers over movies. Users form small "crews" around a specific theater showing, host their own watch parties ("Spaces"), join genre clubs, chat, and play a shared daily film-trivia puzzle called CineMind. It was built by a single developer between June and September 2026 across roughly 400 commits.

The architecture is a React Native client (Expo SDK 56) talking to two backends that share one Postgres database: Supabase for identity, profiles, friendships, messaging, moderation tables and file storage, and a .NET 10 API on Render for everything involving events, groups, notifications, showtimes, and the puzzle game. This split is the single most consequential decision in the codebase, and most of the interesting trade-offs flow from it.

**Overall verdict.** The system is well above the bar for a solo v1. The security posture is unusually deliberate for a project this size: row-level security everywhere on the Supabase side, JWT validation against asymmetric keys, CSPRNG invite codes, row locks on seat-taking, unique indexes as the last line against races, and a complete account-deletion path that satisfies Apple's requirements. The main structural risks are the two-backend coupling, a 2,000-line controller, hand-applied SQL migrations with no tracking, polling instead of realtime for chat, and a showtimes pipeline built on web scraping. None of these block launch. Several of them will hurt at scale, and I list which ones and in what order in Section 20.

---

## 2. Product Context and Constraints

Understanding the constraints explains most decisions.

- **Solo developer, frozen scope.** The stated goal is to ship to the App Store and stop. Scope was frozen in early August, reopened once for the stranger-matching layer, then frozen again. This favors decisions that are cheap to build and cheap to operate over decisions that are optimal.
- **iOS only at launch.** Android is explicitly out of scope. Several Android-only concerns (the notification icon, adaptive icons, App Links) are configured but unverified.
- **No monetization.** The app never touches payment. Cost-splitting is informational. An affiliate tag is wired behind an environment variable but inactive.
- **Low initial density.** The product depends on other people being in the same place at the same time. Every design choice around crews and clubs is shaped by needing to feel alive with a handful of users.
- **The stranger-safety story matters for App Review.** Apple will ask how a stranger-meeting app protects people. Block, report, capacity caps, and server-side enforcement all exist because of that, not as afterthoughts.

---

## 3. System Overview

```
┌──────────────────────────────┐
│  iOS app (Expo 56 / RN 0.85) │
│  expo-router, TypeScript     │
└──────┬───────────────┬───────┘
       │ supabase-js   │ fetch + Bearer JWT
       │ (RLS-gated)   │
┌──────▼──────┐  ┌─────▼──────────────────┐
│  Supabase   │  │ .NET 10 API on Render  │
│  Auth       │  │ EF Core + Npgsql       │
│  Storage    │  │ Hosted services:       │
│  PostgREST  │  │  reminders, CineMind   │
└──────┬──────┘  │  push, nightly scrape  │
       │         └─────┬──────────────────┘
       │               │
┌──────▼───────────────▼──────────────────┐
│  One Postgres database (Supabase)       │
│  public.profiles, friendships, messages,│
│  group_messages, blocks, reports  (RLS) │
│  "Groups", "GroupMembers", PushTokens,  │
│  CineMind tables, ScrapedShowtimes      │
│  (EF-owned, RLS enabled = PostgREST     │
│   cannot read them)                     │
└─────────────────────────────────────────┘

Third parties: OMDb (film metadata), Google Places (theaters),
Expo Push (notifications), Sentry (errors + logs), Resend (email),
cinemaclock.com (scraped showtimes), Cloudflare (DNS for moviespaces.org)
```

**Approximate size**

| Area | Lines |
|---|---|
| Screens (`src/app`) | ~14,200 |
| Client services, hooks, components | ~6,900 |
| Backend controllers and services | ~9,100 |
| Backend tests | 80 xUnit tests across 7 files |
| Supabase SQL migrations | 17 hand-applied files |

---

## 4. Client Architecture

### 4.1 Expo SDK 56, React Native 0.85, expo-router, strict TypeScript

**Decision.** Build on managed Expo with file-based routing rather than bare React Native or a native Swift app.

**Pros**
- One developer can ship a native-feeling iOS app without maintaining Xcode project files by hand. Config plugins in `app.json` generate the native project.
- expo-router gives deep links, typed routes, and a navigation structure for free. The app registers exactly one universal-link path, the Space invite page, and the router handles it.
- EAS builds and `eas submit` collapse the TestFlight pipeline into one script (`npm run ship`).
- Access to Expo's module ecosystem: notifications, calendar, image picker, Apple authentication, secure random values, glass effects.

**Cons**
- The team learned several times that Expo behaviors differ from training-era assumptions, which is why `AGENTS.md` instructs readers to trust the versioned docs. Examples that bit: `Text.defaultProps` being a no-op under React 19, the Apple Sign-In entitlement requiring `ios.usesAppleSignIn` rather than the plugin alone, and Expo Go being unable to test SSO or push at all.
- Some native concerns are still opaque. The notification icon had never been configured because nothing surfaced the omission until a real device showed a generic glyph.
- A dependency footprint you do not fully control. `npm audit fix --force` once downgraded Expo 56 to 46 and had to be reverted from the lockfile.

**Assessment.** Correct choice for a solo iOS launch. The alternatives would have cost weeks of native plumbing for no user-visible gain.

### 4.2 Single fixed dark theme, custom fonts, a wrapped Text component

The app ignores the system light/dark setting and always renders its dark "cosmic" theme. Bebas Neue is used for display text and Karla for body. Every screen imports `Text` from a local wrapper rather than from React Native.

**Pros**
- One theme halves the design and QA surface. For a movie app, a dark theme is also the right default.
- The `scaled-text` wrapper exists because the original font-scaling cap silently did nothing under React 19. Centralizing it means the accessibility cap is enforced everywhere with one import, and it was verified at the largest accessibility text size.

**Cons**
- Forcing dark mode means the native header and system sheets need explicit theme overrides, which the root layout does.
- Every new screen must remember to import the wrapped `Text`. A lint rule banning the React Native import would make this mechanical.

### 4.3 Data fetching: hand-rolled polling, no data library, no realtime

This is the most debatable client decision. There is no React Query, SWR, Redux, or Zustand. Screens call `fetch` or `supabase-js` directly inside effects. Chat polls every 4 seconds, the Space screen every 5, and friends and unread counts every 15. Supabase Realtime is not used anywhere.

**Pros**
- Zero library learning curve and zero abstraction to fight. The codebase is legible to anyone who knows React.
- Polling is trivially resilient. There are no websocket reconnection edge cases, no subscription leaks, no channel authorization to reason about.
- The obvious failure mode of naive polling was fixed well. `use-foreground-poll` stops every poller while the app is backgrounded and refetches once on return. Chat polls fetch only rows newer than the last seen timestamp rather than the whole thread. One `FriendsProvider` at the root replaced five duplicate 15-second pollers.
- Module-level caches for profiles and blocked ids mean the same avatar is not re-fetched by a dozen cards on Home.

**Cons**
- A 4-second poll is not chat. Messages can appear up to 4 seconds late, and every open chat costs a query every 4 seconds per user against a single Render instance. At a few hundred concurrent chatters this becomes the dominant load.
- Supabase Realtime was already available for free on the tables in question and would have given sub-second delivery with the same RLS policies enforcing access. The decision to skip it was a complexity trade, not a capability gap.
- Without a caching layer, each screen owns its own loading, error, and stale-data logic. The `set-state-in-effect` lint rule had to be downgraded to a warning because the pattern is pervasive. That rule was flagging real complexity even if not real bugs.
- No pagination in chat history. The first load takes the newest page and older history is never fetched. A long DM thread simply truncates.

**Assessment.** Defensible for launch, and the foreground gating shows the trade-off was understood. A light data-fetching layer is the next thing I would add.

*Update, 2026-09-05.* Both chat hooks now subscribe to Supabase Realtime inserts through a shared hook, with the poller kept underneath as a fallback. While the subscription is healthy the poll stretches from 4 seconds to 30; on any disconnect it drops back to 4 and refetches immediately, so a Realtime outage degrades to the old behavior rather than to silence. The tables were added to the `supabase_realtime` publication by a new hand-applied migration. This has not yet been exercised on a device.

### 4.4 Optimistic messaging, moderation at the display layer

Chat sends are optimistic with `pending` and `failed` states so a bubble never vanishes mid-flight. Blocked users' messages are filtered client-side on render, in addition to being denied by RLS server-side.

**Pros.** Correct layering: the server enforces, the client hides. The optimistic UI makes chat feel immediate despite the polling delay.

**Cons.** Client-side filtering means the rows still transfer. That is fine at this scale and simplifies the RLS policies.

### 4.5 Onboarding state on the device

Whether a user has completed onboarding is stored in AsyncStorage, not on a server. The flag is cleared on sign-out so the next account on the same phone gets onboarding again.

**Pros.** There is no app-owned users table to put the flag on, and adding one just for this would have been disproportionate.

**Cons.** Reinstall the app and you onboard again. Sign in on a second device and you onboard again. Both are acceptable for v1 but are a papercut users will notice.

### 4.6 Error reporting and logging

Sentry is initialized with a DSN from the EAS production environment only. Tracing samples at 20 percent in production. `console.warn` and `console.error` are forwarded to Sentry Logs, `console.log` deliberately is not.

**Pros.** Crash visibility from day one with source maps uploaded. A canary log fires once per cold start so a broken pipeline is noticed.

**Cons.** A 20 percent trace sample on a tiny user base means the first bugs may not be traced. That is the right call for quota but worth knowing.

### 4.7 Deep links and pending redirects

A Space invite can open the app before sign-in. The root layout stashes the destination and the auth screen replays it after login.

**Assessment.** Small, correct, and the kind of thing usually forgotten. The public invite page deliberately does not auto-redirect to the custom scheme because that produced browser error dialogs for people without the app.

---

## 5. Backend Architecture

### 5.1 .NET 10 with EF Core on Render, in a pinned Docker image

**Decision.** A conventional ASP.NET Core Web API rather than Supabase Edge Functions, a Node service, or pushing all logic into Postgres.

**Pros**
- Strong typing end to end. Nullable reference types are enabled. EF Core migrations give a versioned schema history on this side of the database.
- Hosted services run in-process: a 10-minute reminder poller, the daily CineMind push, and the nightly scrape. No separate cron infrastructure.
- The Dockerfile pins the exact SDK and runtime patch versions the code was verified against, so a Render rebuild cannot silently pick up a newer patch. It also installs the GSSAPI library Npgsql needs against Supabase's pooler, a detail discovered the hard way.
- Configuration is entirely environment-variable driven. The committed `appsettings.json` contains no connection string on purpose. A missing connection string throws at startup rather than booting against a database that does not exist.

**Cons**
- A single Render instance. Every hosted service assumes it might run twice (the CineMind reminder claims the day with a primary-key insert before sending), which is good hygiene, but there is no horizontal scaling story and no separate worker.
- .NET on a hobby platform is unusual. Render's cold start on the free tier was slow enough that the instance was upgraded to always-on, which is now a fixed monthly cost.
- The in-process schedulers mean a redeploy mid-scrape restarts the scrape, and a hung request can delay a reminder. Both are mitigated but neither is eliminated.

### 5.2 Startup pipeline decisions in `Program.cs`

The startup file is heavily commented and each decision is justified inline. The notable ones:

**Migrate on boot, fail fatally.** `MigrateAsync` runs at startup and a failure rethrows so the process exits non-zero and Render keeps the previous instance. This replaced swallowing the error, which once booted an app whose schema did not match its code. Correct, with one caveat: a migration that takes minutes will make deploys look hung.

**CORS locked to explicit origins.** Was `AllowAnyOrigin`. Now the Expo web dev ports plus the marketing site. The comment correctly notes that CORS is a browser mechanism and React Native is unaffected. Credentials are not allowed, so cookie-based CSRF is structurally impossible.

**Forwarded headers, trust exactly one hop.** Render terminates TLS at its proxy. Without this, every request appeared to come from the proxy's IP and the per-IP rate limiter would have shared one bucket for all anonymous users. The accepted trade-off is that `X-Forwarded-For` can be spoofed to dodge rate limits.

**Rate limiting before authentication.** Six named policies: a 300 per minute global limit, 60 for endpoints that call metered third-party APIs, 10 for heavy writes, 30 for anonymous guest joins, plus two for the marketing site's toy counter and signup form and a generous one for analytics events. Because the limiter runs before auth, the partition key is always the client IP today. The user-id branch exists for a future reorder.

*Pros.* An unauthenticated flood is rejected before it costs a JWT signature check. Metered APIs cannot be drained by one free account.
*Cons.* Fixed-window limiters have a burst edge at window boundaries. Signed-in users behind one NAT share a bucket. The global 300 per minute is deliberately loose because the app polls; a tighter limit would have to come after moving off polling.

**256 KB body limit.** Nothing on the API accepts uploads; images go straight to Supabase Storage. Kestrel's 30 MB default was an invitation to waste a small instance's time. Good.

**10-second outbound HTTP timeout.** Every third-party call goes through one configured `HttpClient` default. The prior 100-second default could pin a thread for nearly two minutes on one hung upstream.

**Anonymous `/health` exempt from rate limiting.** Exists to be pinged by an uptime service. Correct that it bypasses the limiter, since a 429 would look like an outage.

### 5.3 Controller layout

Eleven controllers. `GroupController` is roughly 2,000 lines and owns Spaces, crews, clubs, joins, guest joins, invite pages, the Apple and Android association files, booking, editing, and push fan-out for chat.

**Pros.** Everything about a group is in one file, and the file is extraordinarily well commented. Almost every non-obvious line explains what bug it prevents.

**Cons.** A 2,000-line controller with private helpers and inline HTML generation is a maintenance liability. Crews, clubs, hosted Spaces and the public invite page are four distinct concerns. There is no service layer between controllers and `DbContext`, so business rules live in action methods and are untestable without a database, which is exactly why the test suite is limited to pure helpers that were factored out.

**What I would do.** Extract `CrewService`, `ClubService`, `SpaceInviteRenderer`, and `MembershipService`, each taking the `DbContext`. Controllers become thin. Tests could then cover the join and match rules with an in-memory or SQLite provider.

### 5.4 Singleton services with an injected `DbContext`

`PushNotificationService`, `OmdbClient`, `DailyPuzzleService`, and the catalog service are singletons. Where they need the database, the request-scoped `DbContext` is passed as a parameter rather than injected.

**Pros.** Lets a singleton share `IHttpClientFactory` and an in-memory cache across requests while still using the caller's transaction and change tracker. Avoids captive-dependency bugs.

**Cons.** Slightly unusual signature (`NotifyMembersAsync(db, ...)`). New contributors may reach for constructor injection and create a scoped-in-singleton bug. A comment explains it, which is the right mitigation short of a factory.

---

## 6. The Split Data Model

This is the defining architectural trait and deserves its own section.

### 6.1 What lives where

| Owner | Tables | Access path |
|---|---|---|
| Supabase | `profiles`, `friendships`, `messages` (DMs), `group_messages`, `group_message_reads`, `reports`, `blocks`, storage buckets `avatars` and `space-photos` | Client → supabase-js, gated by RLS |
| .NET / EF Core | `Groups`, `GroupMembers`, `GroupBans`, `PushTokens`, `CineMindMovies`, `CineMindTvShows`, `DailyPuzzles`, `UserDailyProgress`, `PuzzleFirstSeen`, `RouletteSpinHistory`, `CineMindReminderLog`, `ScrapedShowtimes`, `AppEvents`, `SiteCounters`, `LaunchSignups` | Client → REST with a Supabase JWT; EF tables have RLS enabled so PostgREST returns nothing for them |

Both sets live in the same physical Postgres database. The linking key is the Supabase auth user id, stored as text in the EF tables.

### 6.2 The coupling point

Group chat lives in Supabase but membership lives in EF. The RLS policy on `group_messages` calls a `SECURITY DEFINER` function, `is_group_message_member`, that reads directly from the EF-owned `"Groups"` and `"GroupMembers"` tables. The current version (2026-09-04) encodes the full business rule: the host can always chat, a confirmed member can chat, any crew member can chat, any club member can chat, and any member can chat once the event has passed.

### 6.3 Pros

- **Supabase gives identity, storage, and RLS for free.** Rewriting auth, avatar storage, and per-row authorization in .NET would have taken weeks and been less secure.
- **The .NET side gives real business logic.** Seat locking, capacity checks, profanity filtering, push fan-out, deterministic puzzle generation, and web scraping do not belong in SQL policies or edge functions.
- **One database, so no distributed transaction problem.** The RLS function can join across the boundary because it is the same Postgres. This is a significant advantage over two separate databases.
- **Account deletion is tractable.** The .NET side deletes its rows by user id, then calls Supabase's admin API to delete the auth user, and every Supabase table cascades from `auth.users`.

### 6.4 Cons

- **Two schema-management regimes.** EF migrations are versioned and applied automatically at boot. Supabase changes are `.sql` files hand-pasted into the dashboard editor. There is no record in the database of which Supabase files have been applied. One of them (`chat_requires_confirmed` v1) errored on apply because it used PascalCase property names instead of snake_case column names, and the only way to know was to re-read the file. This is the most likely source of a production incident in the first month.
- **The RLS function depends on EF's column naming.** EF maps `MatchMovieKey` to `match_movie_key` but leaves `"Confirmed"` and `"Id"` PascalCase and quoted. The SQL function must know which convention each column uses. A future EF rename silently breaks chat authorization, and nothing in `npm run check` would catch it.
- **Two sources of truth for "who is this user."** Display names exist in Supabase `profiles.display_name`, in Supabase auth metadata `full_name`, in EF `GroupMember.Name`, in EF `Group.HostName`, and in EF `UserDailyProgress`. The client has a `display-name` service documenting the precedence. Renames propagate imperfectly; the status doc records a bug where renamed users were seated under signup names.
- **The client joins the two sides itself.** Space members come from .NET with only a name and user id; avatars come from Supabase profiles. Every list of faces does a second query. The `use-profiles` cache mitigates it.
- **Mixed table naming.** EF tables are PascalCase and quoted (`"Groups"`, `"GroupMembers"`) except where explicit `[Column]` attributes give snake_case. Newer EF tables like `cinemind_movies` are snake_case. Three conventions in one schema.

### 6.5 Alternatives considered and why they were not taken

- **All in Supabase (PostgREST + edge functions).** Would remove the .NET service and the coupling. Rejected implicitly because the business logic (locking, scraping, background jobs, deterministic puzzles) is heavy and edge functions are a poor fit for long-running or scheduled work.
- **All in .NET (own auth, own storage).** Would remove RLS and Supabase. Rejected because identity and OAuth are expensive to get right, and Apple Sign-In plus Google plus email with confirmation and password reset is a lot of surface.
- **Keep the split but move chat membership into Supabase.** Would mean duplicating `GroupMembers` into a Supabase-owned table on every join. Rejected in favor of the cross-boundary function, which is cleaner as long as the column names stay stable.

**Assessment.** The split is the right call for the constraints. The remedy for its main weakness is cheap: adopt the Supabase CLI so its migrations are tracked and applied by tooling, and add one integration test that runs the RLS function against a real Postgres.

---

## 7. Authentication and Identity

### 7.1 Supabase Auth with the PKCE flow

The client is configured with `flowType: "pkce"`, session persistence in AsyncStorage, and `detectSessionInUrl: false`. Email plus password, Google, and Apple are supported.

**Pros.** PKCE is the correct flow for a native app; there is no client secret to leak. Session persistence is automatic and refresh is handled by the library.

**Cons.** PKCE requires a cryptographic random source. React Native does not ship `crypto.getRandomValues`. The project installs `react-native-get-random-values` conditionally, only when its native module is present, because installing it unconditionally on an older build made every sign-in throw. If the native module is missing, supabase-js silently falls back to `Math.random`, so the root layout sends a Sentry warning in that case. This is careful engineering around a sharp edge, but it means a build misconfiguration degrades to insecure PKCE rather than failing loudly. The Sentry warning is the compensating control.

### 7.2 Apple native, Google via web OAuth

Apple uses the native `expo-apple-authentication` flow, as App Store guideline 4.8 requires, and hands the identity token to Supabase. Google uses Supabase's generic OAuth in an `openAuthSessionAsync` browser with a custom scheme redirect.

**Pros.** Meets Apple's rule. Avoids a native Google SDK and its configuration. The callback parser reads both query and fragment because errors can land in either, and it logs only the scheme and path, never the code.

**Cons.** Google's flow required a Web-type OAuth client with a client secret in Supabase; an iOS-type client fails with an unhelpful exchange error. Neither SSO path can be tested in Expo Go. Both were verified on a dev build but not yet on a TestFlight build.

### 7.3 Backend JWT validation against Supabase's JWKS

The API points `Authority` at Supabase's auth endpoint and validates issuer, audience (`authenticated`), lifetime, and signature using the published public keys.

**Pros.** No shared secret on the API. Key rotation on the Supabase side is picked up automatically. This matters because the project already had to rotate once: a legacy `JwtSecret` was committed to git, later scrubbed, and Supabase was migrated to asymmetric signing keys. The status doc records that a forged service-role token signed with the leaked secret is now rejected. That is the correct outcome and the right verification.

**Cons.** Every cold start of the API fetches the OIDC metadata and JWKS. If Supabase's auth endpoint is unreachable at boot, the first authenticated requests fail until it recovers. Acceptable.

### 7.4 Email confirmation and password reset

Confirmation is currently off and the code handles both states. Password reset uses a typed OTP code (`verifyOtp` with type `recovery`) rather than a magic link, because the app has no screen to receive a reset link. The email template was changed to show the token as visible text.

**Pros.** Avoids a deep-link handler for reset links. Works on any device.
**Cons.** Codes are less convenient than links. Leaving confirmation off at launch means any email can register; the launch checklist recommends flipping it on.

### 7.5 Token handling on the client

`authFetch` reads the session and adds a Bearer header, omitting it entirely when there is no session so the server's 401 is clean. `authFetchWithTimeout` races the whole call, including the silent refresh inside `getSession`, against a timer, and clears the timer on success because leaked 45-second timers were piling up.

**Assessment.** Small details, all correct.

---

## 8. Authorization and Security Practices

### 8.1 Row-level security on every Supabase table

Every client-facing table has RLS enabled with policies scoped to `auth.uid()`. The evolution visible in the migrations is instructive:

- **Friendships.** The original update policy let either side update, which meant a requester could accept their own request. Hardened on 2026-08-29 to receiver-only.
- **Direct messages.** Originally anyone could message anyone. Changed to friends-only on 2026-07-22, then further gated by blocks.
- **Blocks.** A user can only read their own block rows, which is right for privacy but means the client cannot know who blocked them. Two `SECURITY DEFINER` functions solve this without leaking direction: `is_blocked_between` for policies, and `blocked_peer_ids` returning the union so the client can hide people in both directions.
- **Storage.** The avatar and space-photo buckets got a 5 MB size limit and an image-only MIME allowlist.

**Pros.** Authorization is enforced at the database, so a compromised or modified client cannot read what it should not. Definer functions have pinned `search_path` to prevent hijacking. Permissive policies were folded together rather than stacked, which the migration comment correctly notes is necessary because permissive policies OR together.

**Cons.** RLS logic is invisible to the .NET test suite and to TypeScript. The friendship self-accept hole shipped for six weeks before review caught it. There is no automated test of any policy.

### 8.2 EF-owned tables are RLS-enabled to block PostgREST

Every EF table has `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` with no policies, so the anon and authenticated roles get zero rows through Supabase's REST API while the .NET service, connecting as the owner, sees everything.

**Assessment.** This is the single most important security property of the split model and it is done correctly. Without it, the entire `Groups` table including private Spaces would be readable with the anon key.

### 8.3 Private Spaces and invite codes

A Space can be marked private. Private Spaces are excluded from every browse feed, and both join paths require the six-character space code to match. The code is generated from a CSPRNG over a 32-character alphabet that excludes ambiguous glyphs. The public invite page reveals nothing about a private Space unless the code is presented in the URL, and the attendee list is hidden from non-members even for signed-in callers.

**Pros.** A real access control, not obscurity. 32^6 is about a billion codes, and the join endpoints are rate limited.
**Cons.** Codes are case-insensitively compared, which is fine. A code presented in a URL is logged by any intermediary; acceptable for a social invite.

### 8.4 Concurrency: row locks plus unique indexes

Joining a Space or crew opens a transaction, runs `SELECT ... FOR UPDATE` on the group row, counts members, and inserts. A unique partial index on `(GroupId, UserId)` where `user_id <> ''` is the backstop that turns a double-join into a 409. The same pattern guards once-per-day puzzle submission with a unique `(UserId, PuzzleDate)` index, and the daily reminder with a primary key on the date.

**Pros.** Textbook. The comments correctly explain why a transaction alone is insufficient under read-committed isolation.
**Cons.** The lock serializes all joins to one Space, which is exactly the intent. At 5,000-capacity clubs, join bursts will queue. Acceptable.

### 8.5 Guest joins from the web

An anonymous browser can join a Space from the invite page. Guests are stored with an empty user id and a per-browser guest token that is `[JsonIgnore]`d because it is effectively a bearer credential. Guests are capped at a small number per Space so a griefer cannot fill a real host's event from incognito tabs. The endpoint is IP rate limited at 30 per minute.

**Pros.** Lowers the barrier for a friend without the app. The guest token fix closed a real leak where the token shipped in every member list including the anonymous open feed.
**Cons.** Guests have no bannable identity. Guests are auto-confirmed so the host's confirmation gate does not stall, which means a guest counts toward "going" without any way to un-RSVP.

### 8.6 Input handling

- Every host-supplied text column has a length ceiling in `GroupFieldLimits`, validated before the database so an over-long value is a 400 instead of a 500. This was retrofitted after a `varchar(n)` migration broke three endpoints that were not the one being edited, which is why `AGENTS.md` now says to enumerate every write path before changing a column.
- All user strings on the public invite page are HTML-encoded before interpolation.
- Booking URLs must be `http` or `https` because they open directly in members' in-app browsers.
- A whole-word profanity filter after leetspeak normalization is applied to names and venues. It replaces with a fallback rather than partially masking, and it deliberately avoids substring matching to sidestep the Scunthorpe problem.
- The event analytics endpoint accepts only a locked set of event names.
- A deep-linked DM target is validated as a UUID before being interpolated into a PostgREST filter, because commas and parentheses are syntax there.

### 8.7 Admin surfaces

Seeding, manual scrape, puzzle regeneration, and the analytics summary are `[AllowAnonymous]` endpoints gated by an `x-admin-secret` header compared against a Render environment variable. The reports webhook uses a separate hook secret.

**Pros.** No admin UI to build. Curl and a secret.
**Cons.** A shared static secret in a header is weaker than an authenticated admin role. The endpoints are anonymous to the framework, so they count against the anonymous IP bucket only. Comparison should be constant-time; I did not verify it is. Post-launch I would move these behind `[Authorize]` plus a check against an owner user id, which already exists as `Admin__OwnerUserId` for club moderation.

### 8.8 Secrets management

`appsettings.json` and `eas.json` are committed. Secrets go in Render environment variables and EAS secrets. The `eas.json` file contains the Supabase publishable key and the Sentry DSN, both of which are designed to be public. A JWT secret was once committed and later rotated. A Sentry auth token env var that nothing reads is still on Render and is on the checklist to delete.

**Assessment.** Currently clean. The one lesson, recorded in the project instructions, is that the secret was in git for weeks before anyone noticed. A pre-commit secret scanner would have caught it.

### 8.9 Account deletion

Apple's guideline 5.1.1(v) requires complete deletion. The endpoint deletes hosted Spaces (notifying confirmed members first), memberships, push token, CineMind progress and timing, roulette history, bans naming the user, analytics rows, storage objects, and finally the auth user via the service-role key. Clubs the user owned are orphaned rather than deleted because they are rooms that outlive their creator.

**Pros.** Thorough, and the "clubs survive" distinction is the right product call.
**Cons.** Not transactional across the two systems. If the Supabase admin call fails after the EF rows are gone, the user gets a 500 telling them to contact support. The service-role key is the most powerful credential in the system and lives on the API for this one purpose; that is the correct place for it.

### 8.10 Known weaker spots

Listed honestly, because a review that only praises is not useful.

1. `X-Forwarded-For` spoofing bypasses per-IP rate limits. Accepted trade-off on a PaaS.
2. Rate limits are per IP for signed-in users too because the limiter runs before auth.
3. Admin endpoints use a static header secret.
4. Onboarding completion is client-side state.
5. Ticket ownership is self-reported.
6. The profanity list is deliberately short.
7. No automated tests cover RLS policies.
8. Supabase migrations are untracked.

None of these are launch blockers. Items 7 and 8 are the ones I would fix first.

---

## 9. The Group Domain: Spaces, Crews, Clubs

### 9.1 One table, four concepts

A single `Groups` table represents:

- **Hosted theater Space** (`space_type = public_gathering`): a host picks a real showing and others join.
- **Hosted watch party** (`space_type = private_rental`): a host names a venue and time. Covers movies, TV, sports, gaming, awards.
- **Movie Crew** (`match_movie_key` set, `is_public` true): up to six strangers converging on one showing.
- **Community Club** (`is_public` true, `match_movie_key` null): an evergreen genre room with chat and a leaderboard, seeded by the operator or created by users.

Discriminating flags are `IsPrivate`, `IsPublic`, `MatchMovieKey`, `SpaceType`, and `EventCategory`.

**Pros**
- One membership model, one chat model, one push model, one moderation model. A crew and a club get block and report for free because they are groups.
- The RLS chat function only needs one table.
- Adding crews in August was a handful of new columns rather than a new subsystem.

**Cons**
- The flags interact. The model comment itself warns that `IsPrivate` and `IsPublic` must never both be true and that `IsPublic` must not be inferred from `SpaceType` or a null screening time. Every query that lists groups has to know the right flag combination, and the code has several near-duplicate `Where` clauses across `open`, `crews/open`, `match/open`, and `community-spaces/discover`.
- Legacy columns accumulate. `CinemaId` and `FilmId` from a removed provider remain unused. `TmdbMovieId` remains from a provider that was dropped for licensing reasons. `ShowDate` and `ShowTime` are display strings kept alongside the real `ScreeningTime`.
- Several list-shaped attributes are CSV in a text column: `PostActivities`, `AfterActivities`, and theater memberships on profiles. The comment justifies avoiding Npgsql array mapping. It works, but it prevents indexing and makes "how many members voted drinks" a string split in application code.
- The client infers whether a group is a club with a heuristic; the post-launch doc lists "backend-declared club kind" as owed.

**What I would do.** Keep the single table but add an explicit `kind` enum column (`hosted`, `crew`, `club`) and derive the flag checks from it. This removes the most fragile part of the design without a data migration risk.

### 9.2 Movie Crew, the matching layer

**How it works.** A user picks a film. The server keys crews as `theater:imdb:tt…` or `venue:title:…`. If the user is already seated in a live crew for that key, they are sent back there. Otherwise they either join a listed forming crew, or pick a real showing, in which case the server looks for an existing theater crew with the same venue and exact screening time and seats them there, else creates a new crew with them as the first member. Crews cap at six, close when the showtime passes, and any member can edit the where and when. Film and capacity are locked. A host can remove a member, which creates a ban row so the match flow cannot re-seat them.

**Pros**
- **No waiting pool.** You are instantly in a real, joinable plan even if alone. This is the correct answer to the empty-room problem at low density.
- **Convergence rule is precise.** Same theater and same instant means the same plan. Venue crews never converge because "Home, 8 PM" in two cities is two plans.
- **Six is a deliberate number** borrowed from dinner-table social apps. Small enough to be intimate, large enough that one no-show does not kill it.
- **Commitment is visible, not gated.** Ticket-in-hand is a self-reported badge. Gating on proof would have killed adoption.
- **Bans have teeth.** Before `GroupBans`, removal was cosmetic because the match flow would re-seat the removed person.

**Cons**
- Convergence compares `CinemaName` as a cleaned string. Two showtime sources spelling a theater differently would spawn twin crews. The scraped showtimes cache makes names consistent today.
- A user can be in one crew per film per kind, but nothing prevents someone from being in crews for a dozen films they never attend. Reputation and no-show tracking are post-launch.
- Crews are `IsPublic` so they appear in feeds, but they are also excluded from club discovery by a `MatchMovieKey == null` filter. That is the flag interaction problem from 9.1 in action.

### 9.3 Community Clubs

Seven genre clubs are seeded by an admin endpoint with the operator as host, so they have a moderator. Any user can create a public club, capped at five per creator, with an allow-listed genre and an optional geographic pin. Discovery ranks by today's CineMind activity, then size. Clubs are chat plus a per-club leaderboard; there is nothing to RSVP to. When an owner deletes their account, their clubs become ownerless rather than disappearing.

**Pros.** Solves the day-one empty leaderboard: onboarding auto-joins clubs matching the user's genre picks so they compete with someone immediately. User-created clubs give the community a growth vector that does not depend on the operator.

**Cons.** Ownerless clubs have no moderator. Club moderation beyond message-level report is explicitly post-launch. Capacity is set high enough to never block, so a popular club's chat is a firehose with no threading or paging.

### 9.4 Hosted Spaces

A host creates a Space with a real showing (from the scraped picker) or a venue and time. Members join and then explicitly confirm. Since 2026-09-04, chat on a hosted Space requires confirmation, enforced in RLS, not just hidden in the UI. Hosts can mark the Space booked, unbook it, attach an exact ticket link, edit details (members get a push describing the change), and cancel. Members can flag a showtime as possibly outdated, which increments a counter.

**Pros.** The confirm step is the host's planning tool. Pushing the rule into RLS closed a real gap where a push deep link let unconfirmed members read chat.
**Cons.** The showtime report is a bare counter with no per-user dedupe, acknowledged in the model comment as acceptable at this scale.

---

## 10. Chat and Social Graph

### 10.1 Friendships and DMs

Friendships are a request/accept table in Supabase. DMs are friends-only, enforced in the insert policy by checking for an accepted friendship, and blocked in both directions. Unread counts derive from a per-thread read marker. Friend requests cannot cross a block.

**Pros.** Friends-only DMs are the right default for a stranger-meeting app; you meet in a crew chat first. The RLS policy is the enforcement, not the client.
**Cons.** Friend request spam is bounded only by the block table. There is no request rate limit at the Supabase layer.

### 10.2 Group chat

Rows in `group_messages` keyed by group id, with a `group_type` column that only ever holds `group` now (a `crowdfund` value survives in a check constraint from a removed Stripe feature). Sender name and avatar are joined from profiles client-side with a cache. Read markers in `group_message_reads` power the unread badge on the Spaces tab.

**Pros.** One table serves crews, clubs, and hosted Spaces. Moderation is uniform.
**Cons.** Polling, discussed in 4.3. No message editing or deletion by the sender. Reports go into a table and a webhook emails the operator; there is no in-app moderation queue.

### 10.3 Reports and blocks

Reports insert into a Supabase table with RLS allowing only self-authored inserts. A database webhook posts to the API, which emails the operator via Resend within seconds. Blocks are enforced in every relevant policy and hidden on every social surface via the peer-ids function.

**Assessment.** For a launch, "every report emails the operator in seconds" is a legitimate moderation story and Apple accepts it. It does not scale past one moderator.

---

## 11. Push Notifications

### 11.1 Design

The API sends through Expo's push service in batches of 100. Every send path funnels through one method that de-duplicates tokens and removes any token Expo reports as `DeviceNotRegistered`. Each user holds exactly one token row; registering claims the token from any other account that held it, which fixed a "three identical notifications" bug from multiple accounts on one phone. Every push carries a typed `data` payload the client routes on tap. Turning notifications off in Settings deletes the token server-side rather than setting a client flag the server could not honor. Sign-out also deletes it.

**Pros.** Simple, correct, and the deletion-on-disable is the right mental model: the server has no tokens for users who opted out, so no code path can accidentally notify them.
**Cons.** One token per user means one device per user. Sign in on an iPad and the phone stops receiving. This is a v1 simplification worth revisiting.

### 11.2 Background senders

- **Two-hour reminder.** Polls every 10 minutes for Spaces whose screening time falls in a window ahead of now, flags `ReminderSent`.
- **Daily CineMind reminder.** Fires after 17:00 UTC to everyone who has played at least once and not yet played today. Claims the day with a primary-key insert before sending so two instances cannot both fan out. The hour is chosen so a US player has hours of runway before the UTC rollover.

**Pros.** Both are idempotent under restart and safe under double-instance.
**Cons.** Everything is UTC. The puzzle rolls over at 7 PM Central, which the reminder timing works around rather than fixes.

### 11.3 Notification icon

Until this review, the `expo-notifications` plugin had no icon configured, so Android would show a generic glyph. A 96×96 white-on-transparent icon has now been added along with the brand accent color. On iOS, the notification icon is always the installed app's icon and cannot be changed per notification; a build predating the logo change shows the old logo.

---

## 12. CineMind: The Daily Puzzle

### 12.1 Deterministic generation

One puzzle per UTC day, generated on first request and stored. The RNG is seeded with SHA-256 of the date plus a secret salt, so every player gets the same puzzle and nobody can precompute tomorrow's without the salt. If two requests race to create the day, the loser discards its version and reads the winner's. Films shown in the last six days are excluded, narrowing to three, one, then zero days if the catalog cannot satisfy the constraint, so the day is always generated and always identical regardless of which step succeeded.

**Pros.** Zero daily operations. No content team. The progressive-narrowing fallback is thoughtful: an all-or-nothing exclusion would silently disable freshness on exactly the days it is hardest to achieve.
**Cons.** The catalog is roughly 645 films and 370 shows, curated by hand and clustered around recurring collaborators so shared-person puzzles are generatable. Growing it means editing a list of IMDb ids and reseeding. Determinism also means a bad puzzle is bad for everyone all day; there is an admin regenerate endpoint for that.

### 12.2 Payload schema versioning and answer redaction

The stored payload includes answers and is never sent raw. A `ToClientView` projection strips answers, and tests assert the client view never contains them. Payloads carry a schema version; a subtle bug where the default version made every legacy row look current was caught by a test and fixed with an explicit untagged sentinel. A fifth challenge was later cut but is still generated and graded at zero so older client builds keep working.

**Pros.** This is the most rigorously tested part of the system, and for good reason: leaking an answer breaks the shared daily comparison the format rests on. Scoring eras are tracked so historic rows are judged against their own ceiling.
**Cons.** The payload is JSON in a text column, which is why versioning is needed at all. Fine for this shape of data.

### 12.3 Timing, locking, streaks, leaderboards

Server-authoritative timing starts on first fetch with an atomic insert-on-conflict-do-nothing, replacing a check-then-insert that raced and flooded logs. Once submitted, the puzzle is not returned again; a locked player sees only their results so they cannot coach friends. Streaks and a global leaderboard plus per-club leaderboards are computed from progress rows. A public share page re-grades a past day's stored answers server-side.

**Pros.** Once-per-day is enforced by a unique index. Timing cannot be faked by the client.
**Cons.** Leaderboards query progress rows by date on every request; an index on `PuzzleDate` covers it at current scale.

### 12.4 Roulette

A separate controller serves practice spins that never touch progress or streaks, with an in-memory spin cache and a per-user history capped at 200 rows so a hammering client cannot amplify its own reads.

**Assessment.** The separation is structural, not by convention, which is the right instinct.

### 12.5 Data provider

OMDb rather than TMDb. TMDb's free tier prohibits commercial use; OMDb returns director and cast directly. OMDb has no popularity or list endpoint, so the catalog must be curated. Results are cached 24 hours against the daily quota.

**Assessment.** A licensing-driven choice made correctly. The curated catalog is a feature for puzzle quality even if it is an operational chore.

---

## 13. Showtimes

### 13.1 Scraping cinemaclock.com

There is no free licensed US showtimes API. The backend scrapes one metro's theater pages nightly at 09:00 UTC, one fetch per theater with a multi-second delay, parsing theater identity from JSON-LD and showtimes from `data-time` attributes. Results replace the previous night's rows per theater. Parsing is split into pure functions with fixture tests. A browser user agent is sent because default HTTP client agents are CDN-filtered; the code comment explicitly notes this is not evading a block aimed at the project.

**Pros.** The picker offers only real theaters, films, and times, so a Space cannot be created with a showtime that does not exist. That is a real product improvement over the previous "look it up on Google and type it in" flow. The nightly cadence and per-request delay are less load than one human visitor. Failures are logged per theater so a total break is visible.
**Cons.** This is the highest operational risk in the system. Markup changes break it silently between deploys; the site's terms are a gray zone; coverage is one metro. A configuration typo (`Showtimes__Cities=15`) once stopped all data for days before anyone noticed. The permanent fallback is that hosts can still type a showtime by hand.

**Assessment.** An honest, documented trade-off, made with the owner's explicit acceptance. I would add a Sentry alert when a nightly run yields zero rows, and keep the AMC vendor API as the replacement path.

### 13.2 Theaters and time zones

Theaters come from Google Places, rate-limited because it bills per request. Scraped wall-clock times are stored as theater-local Central time and converted through the real `America/Chicago` zone because a fixed UTC-6 was wrong for eight months of the year.

---

## 14. Third-Party Services and Infrastructure

| Service | Role | Notes |
|---|---|---|
| Render (Starter) | Hosts the .NET API in Docker | Upgraded from free to always-on so background jobs run and cold starts stop looking like outages |
| Supabase | Auth, Postgres, Storage, PostgREST | Single project; asymmetric JWT keys since 2026-08-17 |
| Expo EAS | Builds, submit, secrets | Production build script is local build then submit |
| Sentry | Errors, traces, structured logs | Both client and backend; EF SQL logging turned down so it does not eat the quota |
| Resend | Transactional email | Auth email through custom SMTP on `moviespaces.org`; report and feedback emails via API |
| Cloudflare | DNS for `moviespaces.org` | DKIM, SPF, DMARC configured |
| OMDb | Film and TV metadata | Daily quota, 24-hour cache |
| Google Places | Theater search | Metered, rate limited |
| cinemaclock.com | Scraped showtimes | See Section 13 |

**Cost profile.** Roughly one paid Render instance plus Supabase and Sentry free tiers. This is about as cheap as a system with a real backend gets.

**Single points of failure.** One Render instance, one Supabase project, one operator. Any of the three going away stops the product. Appropriate for v1.

---

## 15. Observability and Operations

- **Sentry Logs** on both sides with structured placeholders in .NET logger calls.
- **A SaveChanges interceptor** logs the SQL state, table, constraint, and column of any failed write without the row values Npgsql redacts, turning an anonymous `DbUpdateException` into one identifiable line across every write path at once.
- **Migrate on boot fails the deploy** rather than booting a mismatched schema.
- **A health endpoint** exists for an uptime pinger.
- **A minimal analytics table** records named events per user with an admin summary endpoint. Deliberately no vendor and no properties bag; the comment says it exists to make three specific post-launch decisions with data instead of vibes.

**Assessment.** Good for the size. Missing: an alert on zero scraped rows, an alert on zero CineMind reminder recipients when there should be some, and any dashboard. All three are an afternoon each.

---

## 16. Testing and Quality Gates

### 16.1 What exists

Eighty xUnit tests covering answer redaction, grading invariants, payload deserialization across schema versions, push token validation and dead-token parsing, screening-time rules, and the showtimes HTML parser against fixtures. All are pure logic with no database or HTTP. `npm run check` runs TypeScript, ESLint, and the test suite in one command and is required before any change is considered done.

### 16.2 What does not exist

- No client tests of any kind. Screens, hooks, and services are verified by hand on a device.
- No integration tests against Postgres. Join races, RLS policies, and the cross-boundary chat function are exercised only in production.
- No end-to-end tests. A 33-flow manual checklist hosted on the marketing site is the device QA plan.
- `npm run check` never boots the web host, so a configuration change can pass every check and crash on deploy. This happened with a comment key inside `Logging.LogLevel`.

### 16.3 Assessment

The test strategy is rational: test the parts where a bug is invisible until it is catastrophic (answer leaks, schema drift, parser breakage) and rely on device QA for the parts where a bug is obvious the first time you tap it.

*Update, 2026-09-05.* A `backend.IntegrationTests` project now exists. It boots the real `Program.cs` against a throwaway Postgres container (or a server named in `MOVIESPACES_TEST_PG`), swaps JWT validation for a header-based test scheme, and skips cleanly when neither is available so the check command still needs no infrastructure. Eleven tests cover: concurrent joins never exceeding capacity, one user tapping join eight times being seated once, fifteen strangers racing for a six-seat crew, and eight scenarios for the chat RLS function (host, confirmed, unconfirmed, non-member, crew, club, passed event, blocks in both directions, and sender spoofing). The fixture also applies every Supabase SQL file in order, which is the check that would have caught the casing error in the first version of the chat-confirmation migration. A mutation run with the row lock removed made the two capacity tests fail, seating nine people in a four-seat Space, which is the evidence the tests exercise the guard rather than passing vacuously.

The repeated pattern in the project's own history, where a review pass or a test found a bug that "looked right," validates the `AGENTS.md` rule to verify before claiming. Two full code-review passes over the crew feature found roughly seventeen confirmed issues. That is a healthy ratio and argues for making review a fixed step rather than an occasional one.

---

## 17. Delivery Process

- **Branching.** Work lands on `feature/pushingdata` and merges to `main` via pull request. `main` deploys to Render automatically. At one point `main` was 118 commits behind and nothing was deployed for weeks, which the status doc calls out.
- **Supabase changes** are SQL files pasted into the dashboard. Not tracked.
- **Documentation as memory.** `PROJECT_STATUS.md`, `LAUNCH_CHECKLIST.md`, `POST_LAUNCH.md`, `TESTER_CHECKLIST.md`, and `AGENTS.md` are written to be read cold and are kept current. For a solo project relying heavily on AI-assisted sessions, this is the right investment. The codebase's inline comments serve the same purpose; they explain the bug each line prevents rather than what the line does.
- **The README** is still the Expo template. Harmless but a small signal of where polish stopped.

**Assessment.** The process is light and appropriate. The one structural fix is tracked Supabase migrations.

---

## 18. Decision Register

A compact view of the major decisions, each with the strongest argument on both sides.

| Decision | Strongest pro | Strongest con | Verdict |
|---|---|---|---|
| Expo managed workflow | Solo dev ships native iOS without Xcode plumbing | Platform surprises; Expo Go cannot test SSO or push | Right |
| Two backends, one database | Free identity, storage, RLS plus real business logic | Hand-applied Supabase SQL; RLS function depends on EF column names | Right, needs tracked migrations |
| Polling instead of realtime | Zero websocket complexity | 4-second chat, per-user load on one instance | Acceptable for v1, replace first |
| No data-fetching library | Legible, no abstraction | Duplicated loading/error logic, lint rule downgraded | Acceptable |
| Single `Groups` table for four concepts | Uniform membership, chat, moderation | Flag interactions, legacy columns, CSV lists | Right, add a `kind` column |
| Crews with no waiting pool | Instantly usable at zero density | Solo crews feel empty | Right |
| Six-person crew cap | Intimate, one no-show survivable | Arbitrary | Right |
| Self-reported tickets | No adoption friction | No guarantee anyone shows | Right for v1 |
| Friends-only DMs | Safety default for stranger app | Extra step before messaging | Right |
| JWKS validation, no shared secret | Rotation is automatic; leaked secret is inert | Boot depends on Supabase reachability | Right |
| PKCE with conditional random polyfill | Correct flow for native | Silent insecure fallback if native module missing | Right, watch the Sentry canary |
| Row lock + unique index on joins | Correct under read-committed | Serializes joins per group | Right |
| Rate limiter before auth | Cheap rejection of floods | IP-keyed for everyone | Right |
| Deterministic salted puzzle | Zero daily ops | Bad day is bad for everyone | Right |
| Curated OMDb catalog | Licensing-clean; puzzle quality | Manual curation | Right |
| Scraped showtimes | Real showings in the picker | Fragile, gray-zone | Accepted risk, alert on it |
| One push token per user | Simple, fixes duplicate sends | One device per user | Revisit |
| Migrate on boot, fail fatal | Never run mismatched schema | Long migrations look hung | Right |
| Header-secret admin endpoints | No admin UI needed | Weaker than authenticated admin | Replace post-launch |
| Onboarding flag on device | No users table needed | Re-onboard on reinstall | Acceptable |
| Manual Supabase migrations | Fast to apply | Untracked, already misfired once | Fix |

---

## 19. Cross-Cutting Observations

**The comments are the architecture document.** Almost every non-obvious line explains which bug it prevents, often with the date it was found. This is unusual and valuable. It also means the codebase's institutional memory lives in one place and will survive the developer stepping away.

**Races were taken seriously from the start.** Unique indexes, row locks, insert-on-conflict, and claim-before-send appear everywhere concurrent writes are possible. Most solo projects skip all of this and discover it in production.

**Security was iterated, not assumed.** The migration history shows policies being tightened as reviews found holes: DMs open to anyone, friendship self-accept, guest token leakage, chat readable by unconfirmed members via deep link, PostgREST exposure of EF tables. Each fix landed at the enforcement layer, not just the UI.

**The developer knows where the debt is.** `POST_LAUNCH.md` and the status document list the same items this review does. There is little I found that the project had not already named.

---

## 20. Ranked Recommendations

Ordered by consequence per hour of effort, all post-launch except the first.

1. **Track Supabase migrations.** Adopt the Supabase CLI or at minimum a `schema_migrations` table the SQL files insert into. One misfire has already happened. Half a day. The integration suite now at least proves the files parse and apply in order.
2. ~~One integration test against real Postgres.~~ Done 2026-09-05; see Section 16.
3. **Alert on zero scraped rows** and on a reminder pass with zero recipients when progress rows exist. Half a day.
4. ~~Supabase Realtime for chat.~~ Done 2026-09-05 with polling kept as the fallback; device QA still owed.
5. **Add a `kind` column to `Groups`** and derive the flag checks from it. One day plus a migration.
6. **Extract services from `GroupController`.** Makes the file maintainable and the integration tests cheaper to extend. Two days.
7. **Multiple push tokens per user.** Change the token table to key on token rather than user, keep the claim-on-register behavior. One day.
8. **Authenticated admin endpoints** using the owner user id already in config. Half a day.
9. **Pre-commit secret scanning.** An hour.
10. **Chat history paging.** Half a day.

---

## 21. Closing Assessment

MovieSpaces is a well-engineered v1 built under real constraints. The architecture makes one large bet, splitting the backend between Supabase and .NET on a shared database, and executes it carefully enough that its weaknesses are operational rather than structural. Security is enforced at the database and the API, not the UI. Concurrency is handled correctly. The parts that are fragile are fragile by acknowledged choice, documented, and have fallbacks.

If I were joining this project tomorrow, I would ship the current build, then spend the first two post-launch weeks on tracked migrations, one integration test suite, and realtime chat, in that order. Everything else can wait for users.

---

## Appendix A: Endpoint Inventory

**Groups** (`/api/group`): create, resolve by code, get by id or slug, open feed (anonymous), search, mine, join, join-web (anonymous, rate limited), confirm, unconfirm, book, unbook, booking-url, edit, cancel, remove member, report-showtime, notify-message, after-activities, ticket, match, match/open, crews/open, community-clubs create, community-spaces discover and seed (admin). Also serves `/space/{id}` invite HTML and the Apple and Android association files.

**Game** (`/api/game`): puzzles/today, puzzles/submit, stats, leaderboard/global, spaces/{id}/leaderboard, catalog/browse, catalog/seed and seed-tv (admin), puzzles/today/regen (admin). Also serves `/cinemind-result/{id}` share HTML.

**Roulette** (`/api/roulette`): spin, grade.

**Movies** (`/api/movies`, metered): search, title-lookup, search-tv, now-playing.

**Locations** (`/api/locations`, metered): nearby-theaters.

**Showtimes** (`/api/showtimes`): theaters, theaters/{slug}, scrape (admin).

**Push tokens** (`/api/pushtokens`): register, delete, notify-dm.

**Account** (`/api/account`): delete.

**Events** (`/api/events`): record, summary (admin).

**Site** (`/api/site`): clapper get and post, notify, notify/list, report-hook, feedback. All anonymous with their own rate-limit buckets.

**Legal**: `/legal/privacy`, `/legal/terms`, `/support` as HTML.

**Health**: `/health`.

## Appendix B: Table Inventory

**Supabase-owned:** `profiles` (display name, username, avatar, theater memberships CSV, favorite and least-favorite movies as jsonb), `friendships`, `messages`, `group_messages`, `group_message_reads`, `reports`, `blocks`; storage buckets `avatars` and `space-photos`. Leftover from removed features: `spaces`, `space_pledges`, `space_interests` (crowdfunding, removed 2026-07-20).

**EF-owned:** `Groups`, `GroupMembers`, `GroupBans`, `PushTokens`, `cinemind_movies`, `cinemind_tv_shows`, `DailyPuzzles`, `UserDailyProgress`, `PuzzleFirstSeen`, `roulette_spin_history`, `CineMindReminderLog`, `ScrapedShowtimes`, `AppEvents`, `SiteCounters`, `LaunchSignups`, and a vestigial `MovieSpaces` table from the template.

## Appendix C: Key Constants

| Constant | Value | Where |
|---|---|---|
| Crew capacity | 6 | `GroupController.MatchCrewSize` |
| Clubs per creator | 5 | `CreateCommunityClub` |
| Default Space capacity | 40 | `Group.MaxCapacity` |
| Space code alphabet | 32 chars, 6 long | `GroupController` |
| Global rate limit | 300 per minute per IP | `Program.cs` |
| Guest join limit | 30 per minute per IP | `Program.cs` |
| Request body cap | 256 KB | `Program.cs` |
| Outbound HTTP timeout | 10 s | `Program.cs` |
| Chat poll | 4 s foreground only | `use-chat`, `use-group-chat` |
| Space screen poll | 5 s | `group.tsx` |
| Friends and unread poll | 15 s | `FriendsProvider` |
| CineMind reminder hour | 17:00 UTC | `CineMindReminderService` |
| Reminder poll | 10 min | both reminder services |
| Puzzle repeat window | 6 days, narrowing to 0 | `DailyPuzzleService` |
| Roulette history cap | 200 rows per user | `DailyPuzzleService` |
| Storage upload cap | 5 MB, images only | Supabase bucket config |
| Sentry trace sample | 20 percent in production | `sentry.ts` |
