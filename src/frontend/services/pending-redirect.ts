import type { Href } from "expo-router";

// A deep-linked Space invite (moviespaces.onrender.com/space/{id} — the only
// path app.json registers as a universal/app link) can open the app before
// the user is signed in. _layout.tsx force-redirects unauthenticated users to
// /auth, which would otherwise drop the invite on the floor; this stashes the
// original destination so auth.tsx can send the user there after they sign
// in/up instead of dumping them on the home tab.
let pendingRedirect: Href | null = null;

export function setPendingRedirect(href: Href) {
  pendingRedirect = href;
}

export function consumePendingRedirect(): Href | null {
  const href = pendingRedirect;
  pendingRedirect = null;
  return href;
}
