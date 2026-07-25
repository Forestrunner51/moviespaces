// Builds outbound ticket-purchase URLs. Users buy their own tickets directly
// from the theater/Fandango — the app never touches payment, just hands off.
//
// Affiliate tag: set EXPO_PUBLIC_AFFILIATE_TAG (e.g. a CJ Affiliate token) in
// .env to append passive revenue tracking to every outbound ticket link. Left
// unset, links go out untagged.
const AFFILIATE_TAG = process.env.EXPO_PUBLIC_AFFILIATE_TAG;

function withAffiliateTag(url: string): string {
  if (!AFFILIATE_TAG) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}cjevent=${encodeURIComponent(AFFILIATE_TAG)}`;
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
