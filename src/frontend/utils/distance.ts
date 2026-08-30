// Straight-line (haversine) distance in miles between two lat/lng points.
export function distanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 3958.8; // Earth radius in miles
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Human label for a haversine distance, shared by every "N mi away" caption
// so the cutoff and copy can't drift between call sites. Null when unknown
// or when the distance is far enough to read as noise (a pin on another
// coast) rather than information.
export function formatMilesAway(mi: number | null): string | null {
  if (mi == null || mi > 500) return null;
  return mi < 1 ? "under a mile" : `~${Math.round(mi)} mi`;
}
