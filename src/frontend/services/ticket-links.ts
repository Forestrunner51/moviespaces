// Builds outbound ticket-purchase URLs. Users buy their own tickets directly
// from the theater/Fandango — the app never touches payment, just hands off.
//
// Affiliate tag: set EXPO_PUBLIC_AFFILIATE_TAG (e.g. a CJ Affiliate token) in
// .env to append passive revenue tracking to every outbound ticket link. Left
// unset, links go out untagged.
const AFFILIATE_TAG = process.env.EXPO_PUBLIC_AFFILIATE_TAG;

function withAffiliateTag(url: string): string {
  if (!AFFILIATE_TAG) return url;

  // The param has to go BEFORE any fragment, not on the end of the string.
  // Naively appending puts it inside the fragment ("...#showtimes?cjevent=X"),
  // where it isn't a query parameter at all — the tracking silently doesn't
  // work and the fragment itself is corrupted. That matters more now that
  // hosts paste real Fandango showtime URLs into a Space (see the "Exact
  // Ticket Link" field in create-space.tsx); those routinely carry fragments.
  const hashIndex = url.indexOf("#");
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : url.slice(hashIndex);

  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}cjevent=${encodeURIComponent(AFFILIATE_TAG)}${fragment}`;
}

// Opens Google's movie-showtimes results for a film. Google auto-detects the
// user's location and renders local theaters, exact showtimes, screen formats
// (IMAX/3D), and ticket-purchase links (Fandango/AMC/Cinemark/…) — a zero-cost
// alternative to a paid showtimes API. `location` (e.g. the picked theater's
// name) narrows the query when known, otherwise "near me" lets Google localize.
export function buildGoogleShowtimesUrl(movieTitle: string, location?: string | null): string {
  const query =
    location && location.trim()
      ? `${movieTitle} showtimes ${location.trim()}`
      : `${movieTitle} showtimes near me`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

// Prefers a real booking URL (e.g. a specific showtime page) when the group
// has one; otherwise falls back to a generic Fandango search for the film so
// there's always something useful to hand off to.
export function buildTicketUrl(filmName: string, bookingUrl?: string | null): string {
  const base =
    bookingUrl && bookingUrl.trim()
      ? bookingUrl.trim()
      : `https://www.fandango.com/search?q=${encodeURIComponent(filmName)}`;
  return withAffiliateTag(base);
}

// "Rent a Theater" is pure discovery/hand-off — the app doesn't know which
// theaters actually offer private rentals (no data source for that), so this
// just searches for the theater's own rental/private-event info instead of
// pretending to book anything. The user decides what movie/activity to do
// with the space directly with the theater.
export function buildRentalInquiryUrl(theaterName: string): string {
  const query = `${theaterName} private theater rental`;
  return withAffiliateTag(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
}
