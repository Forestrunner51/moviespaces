import * as Sentry from "@sentry/react-native";

// No DSN configured (e.g. local dev without EXPO_PUBLIC_SENTRY_DSN set) means
// Sentry.init() below just never fires — every Sentry.* call elsewhere in
// the app becomes a silent no-op rather than throwing, so this is safe to
// leave unconfigured in any environment.
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 1.0,
    debug: false,
  });
}
