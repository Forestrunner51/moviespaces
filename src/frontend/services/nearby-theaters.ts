import * as Location from "expo-location";

export interface NearbyTheater {
  placeId: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
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

// Reverse-geocodes coordinates into a "City, Region" string (e.g.
// "Frisco, Texas") for SerpApi's `location` param, which expects a geographic
// place — NOT a venue name like "AMC Stonebriar 24". Passing a theater name
// there makes SerpApi ignore/reject it and Google's showtimes box never
// renders. Returns null when it can't resolve, so the caller can fall back.
export async function reverseGeocodeCity(coords: Coordinates): Promise<string | null> {
  try {
    const results = await Location.reverseGeocodeAsync({
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
    const place = results[0];
    if (!place) return null;
    const parts = [place.city ?? place.subregion, place.region].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  } catch (err) {
    console.warn("Reverse geocode failed:", err);
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
