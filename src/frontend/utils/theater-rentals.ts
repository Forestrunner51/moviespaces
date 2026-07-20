import { cinemaChain } from "@/frontend/constants/theater-memberships";

// Best-effort mapping to each chain's corporate rental/private-event page.
// Not guaranteed stable — these vendor pages get restructured over time and
// we have no way to verify them live from here — so an unknown or wrong path
// should degrade to the Google search fallback, never a dead link with no
// escape hatch.
const CHAIN_RENTAL_URLS: Record<string, string> = {
  AMC: "https://www.amctheatres.com/programs/theatre-rentals",
  Cinemark: "https://www.cinemark.com/private-watch-party",
  Regal: "https://www.regmovies.com/private-events",
};

export function getCorporateRentalUrl(theaterName: string): string {
  const chain = cinemaChain(theaterName);
  if (chain && CHAIN_RENTAL_URLS[chain]) {
    return CHAIN_RENTAL_URLS[chain];
  }
  const query = `${theaterName} private rental booking`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
