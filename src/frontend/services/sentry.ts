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
    // Turn on the Sentry Logs product (structured logs), separate from crash
    // reporting. Without this every Sentry.logger.* call and the console
    // integration below are silent no-ops — which is why no logs were showing.
    enableLogs: true,
    integrations: [
      // Forward existing console.warn / console.error to Sentry Logs so the
      // app's current diagnostics (e.g. the OAuth failure path in sso.ts)
      // become searchable without hand-instrumenting each site. log/info/trace
      // are deliberately left out to keep noise and log quota down.
      Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
    ],
  });

  // Canary + example of the direct structured-logging API. Fires once per cold
  // start, so it's low-volume, and it doubles as proof logs are flowing:
  // if you see "app.startup" in Sentry → Logs, the pipeline works.
  // Best practice: a short stable message + structured attributes you can
  // filter on, rather than interpolating values into the message string.
  Sentry.logger.info("app.startup", { platform: "mobile" });
}
