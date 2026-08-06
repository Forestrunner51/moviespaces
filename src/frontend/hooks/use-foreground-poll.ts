import { useEffect, useRef } from "react";
import { AppState } from "react-native";

// Runs `callback` on an interval, but ONLY while the app is in the foreground.
//
// Every poller in this app previously used a bare setInterval, which keeps
// firing after the user switches away or locks the phone: chat polls at 4s,
// a Space screen at 5s, and three separate 15s pollers for unread counts and
// friends. A backgrounded app was still driving all of that — burning the
// user's battery and radio, and hammering a single free-tier Render instance
// with requests nobody was going to look at. iOS suspends timers eventually,
// but not immediately and not predictably, and Android is far more permissive.
//
// Semantics deliberately match what the bare-setInterval call sites already
// did, so swapping them over changes nothing a user would notice:
//   - fires once immediately on mount (every call site did `load(); setInterval(load)`)
//   - fires immediately again on returning to the foreground, so a screen
//     that's been backgrounded shows fresh data rather than whatever was on
//     screen when the user left, then waits a full interval
//   - stops entirely while backgrounded
//
// `callback` is held in a ref so the interval doesn't need re-creating every
// render just because the closure identity changed — call sites can pass an
// unmemoized function (most of these hooks do) without their poll restarting,
// and losing its place in the interval, on every render.
//
// `restartKey` is what that ref costs us, and it is not optional in practice.
// Because the callback is invisible to the dependency array, changing *what*
// is being polled — opening a different chat, switching Spaces — would
// otherwise not restart anything: the next tick would quietly fetch the new
// target up to a full interval later, leaving the previous target's data on
// screen until then (these hooks don't clear their state on target change).
// The bare-setInterval versions this replaced got that right for free by
// listing the target in their deps. Pass whatever identifies the poll target
// and it restarts immediately, exactly as they did.
export function useForegroundPoll(
  callback: () => void,
  intervalMs: number,
  enabled: boolean = true,
  restartKey?: string | number,
) {
  const savedCallback = useRef(callback);

  // Declared before the effect below so it runs first on every render pass —
  // effects fire in declaration order, so the interval effect always sees the
  // current callback rather than the one from the render that started it.
  useEffect(() => {
    savedCallback.current = callback;
  });

  useEffect(() => {
    if (!enabled) return;

    let interval: ReturnType<typeof setInterval> | null = null;
    const tick = () => savedCallback.current();

    const start = () => {
      // Guard against double-start: AppState can emit "active" when it was
      // already active (e.g. an "inactive" blip from a system dialog or the
      // iOS app switcher that never actually backgrounded us), and without
      // this that would leak a second interval every time.
      if (interval != null) return;
      tick();
      interval = setInterval(tick, intervalMs);
    };

    const stop = () => {
      if (interval == null) return;
      clearInterval(interval);
      interval = null;
    };

    if (AppState.currentState === "active") start();

    // "inactive" (iOS app switcher / incoming call overlay) is treated as
    // stopped along with "background" — the app isn't visible enough to be
    // worth polling for, and `start` re-fires immediately on the way back.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") start();
      else stop();
    });

    return () => {
      stop();
      subscription.remove();
    };
  }, [enabled, intervalMs, restartKey]);
}
