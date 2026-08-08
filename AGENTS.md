# Start here

Read `PROJECT_STATUS.md` first — it has the current state, what's done, what's
owed, and the exact next step. `LAUNCH_CHECKLIST.md` is the tactical
tick-through version of the same thing.

**The goal right now is to ship this to the App Store and be done.** Scope is
frozen: bugs and launch blockers only, no new features.

# Expo version

Built on Expo SDK 56. If anything Expo/React-Native-related contradicts what
you'd assume, trust the versioned docs at
https://docs.expo.dev/versions/v56.0.0/ over training knowledge.

# Working conventions

- **Verify before claiming.** Run the build, grep the file, read the code.
  Several real bugs this project has hit came from an assumption that sounded
  right and wasn't. Don't report something as working because it looks like it
  should.
- **`npm run check` before considering any change done** — tsc + eslint +
  `dotnet test` (42 backend tests). Needs no live infrastructure.
- **Schema changes: enumerate every write path.** Adding a column constraint
  has twice now broken endpoints that weren't the one being edited (the
  `varchar(n)` length caps missed `EditGroup`, `UpdateBookingUrl`, and
  `JoinGroup`). Grep for every writer of a column before changing its shape.
- **Never commit a credential.** `appsettings.json` and `eas.json` are both in
  git. Secrets go in Render env vars (backend) or `eas secret:create` (build).
  A `JwtSecret` already had to be scrubbed once.
