import * as Location from "expo-location";
import { authFetch } from "@/frontend/services/api";

export interface NearbyTheater {
  placeId: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  // Google Places types (e.g. "movie_theater", "bar", "community_center") —
  // the backend searches a broad set of venue types (Watch Parties can be
  // hosted at bars/community centers too), so the client filters this list
  // down per space type rather than the server doing it, which lets
  // switching space types re-filter instantly with no extra network call.
  types: string[];
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

// Falls back to null (rather than throwing) when permission is denied or
// location can't be resolved — callers should show a manual-entry fallback
// instead of a hard error, same pattern as the old "no nearby theaters found"
// empty state.
//
// Bounded: getCurrentPositionAsync can hang for a very long time indoors or
// with location services degraded, and every caller awaits it before showing
// anything. The last known fix (usually milliseconds old, from the OS cache)
// is tried first; a fresh fix races a timeout, after which the caller gets
// null and its no-location path — the same as a denied permission.
const LOCATION_TIMEOUT_MS = 10000;

// Last coordinates any call in this session resolved. A cold GPS fix that
// times out shouldn't strand the user with "no location" when we knew where
// they were twenty minutes ago — for a 60-mile theater radius and distance
// sorting, a stale metro-area fix beats null every time.
let lastGoodCoords: Coordinates | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Location timed out")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export async function getDeviceLocation(): Promise<Coordinates | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;

    // Fresh OS-cached fix: instant, and the common case after the first
    // successful fix of the day.
    const lastKnown = await Location.getLastKnownPositionAsync({
      maxAge: 5 * 60 * 1000,
    }).catch(() => null);
    if (lastKnown) {
      lastGoodCoords = { latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude };
      return lastGoodCoords;
    }

    try {
      const position = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        LOCATION_TIMEOUT_MS,
      );
      lastGoodCoords = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      return lastGoodCoords;
    } catch (err) {
      // Cold fix timed out (typical indoors on the first open of the day).
      // Degrade through progressively staler-but-real positions instead of
      // giving up: any OS-cached fix from the last day, then whatever this
      // session already resolved.
      console.warn("Fresh location fix failed, falling back to stale:", err);
      const stale = await Location.getLastKnownPositionAsync({
        maxAge: 24 * 60 * 60 * 1000,
      }).catch(() => null);
      if (stale) {
        lastGoodCoords = { latitude: stale.coords.latitude, longitude: stale.coords.longitude };
        return lastGoodCoords;
      }
      return lastGoodCoords;
    }
  } catch (err) {
    console.warn("Failed to get device location:", err);
    return lastGoodCoords;
  }
}

// Throws with the server's actual error message on failure (e.g. a missing
// GooglePlaces:ApiKey on the backend) instead of silently returning an empty
// list — an empty list looks identical to "no theaters nearby", which made a
// real backend misconfiguration invisible in the UI.
//
// authFetch, not plain fetch — LocationsController is [Authorize]d (an
// unauthenticated proxy to a billed API would let anyone run up the Google
// Places bill), so this needs the bearer token.
// query: optional — switches the backend from Nearby Search (New) (capped
// at 20 results, no pagination, "what's physically closest") to Text Search
// (New) (searches by name, location only used as a bias). Without this, a
// specific venue that isn't among the nearest 20 generic hits is never
// findable no matter what's typed into a client-side filter over that fixed
// list — which is what this replaces.
export async function fetchNearbyTheaters(
  coords: Coordinates,
  radiusMeters?: number,
  query?: string,
): Promise<NearbyTheater[]> {
  const radiusParam = radiusMeters != null ? `&radiusMeters=${radiusMeters}` : "";
  const queryParam = query?.trim() ? `&query=${encodeURIComponent(query.trim())}` : "";
  const res = await authFetch(
    `${process.env.EXPO_PUBLIC_API_URL}/api/locations/nearby-theaters?latitude=${coords.latitude}&longitude=${coords.longitude}${radiusParam}${queryParam}`,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Failed to load nearby theaters (status ${res.status}).`);
  }
  const data = await res.json();
  return data.theaters || [];
}
