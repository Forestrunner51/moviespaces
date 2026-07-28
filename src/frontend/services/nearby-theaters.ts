import * as Location from "expo-location";

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

export interface UserPlace {
  city: string | null;
  state: string | null;
}

// Resolves the device's coordinates to a city/state, which the showtimes API
// maps to a scrapable metro ("Frisco, TX" -> "dallas"). Returns nulls rather
// than throwing on denied permission or a geocoder miss — the caller just
// loses on-demand showtimes and falls back to the Google link.
export async function getUserPlace(coords: Coordinates): Promise<UserPlace> {
  try {
    const results = await Location.reverseGeocodeAsync(coords);
    const first = results?.[0];
    if (!first) return { city: null, state: null };
    return {
      // `city` is null in some regions where the locality lands in
      // `subregion` (county) instead.
      city: first.city ?? first.subregion ?? null,
      state: first.region ?? null,
    };
  } catch (err) {
    console.warn("Reverse geocode failed:", err);
    return { city: null, state: null };
  }
}

// Falls back to null (rather than throwing) when permission is denied or
// location can't be resolved — callers should show a manual-entry fallback
// instead of a hard error, same pattern as the old "no nearby theaters found"
// empty state.
export async function getDeviceLocation(): Promise<Coordinates | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return { latitude: position.coords.latitude, longitude: position.coords.longitude };
  } catch (err) {
    console.warn("Failed to get device location:", err);
    return null;
  }
}

// Throws with the server's actual error message on failure (e.g. a missing
// GooglePlaces:ApiKey on the backend) instead of silently returning an empty
// list — an empty list looks identical to "no theaters nearby", which made a
// real backend misconfiguration invisible in the UI.
export async function fetchNearbyTheaters(coords: Coordinates): Promise<NearbyTheater[]> {
  const res = await fetch(
    `${process.env.EXPO_PUBLIC_API_URL}/api/locations/nearby-theaters?latitude=${coords.latitude}&longitude=${coords.longitude}`,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Failed to load nearby theaters (status ${res.status}).`);
  }
  const data = await res.json();
  return data.theaters || [];
}
