import { useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SpaceTheme } from "@/frontend/constants/theme";
import { fetchShowtimes, SelectedShowtime, Theater } from "@/frontend/services/showtimes";

interface Props {
  imdbId: string | null; // IMDb id of the picked movie (required for lookup)
  lat: number | null;
  lng: number | null;
  date?: string; // YYYY-MM-DD; defaults server-side to today
  onSelectShowtime: (selected: SelectedShowtime) => void;
}

// Formats an ISO start_at into a local "7:15 PM". Falls back to the raw string
// if it isn't a parseable date.
const formatIsoTime = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
};

// Pulls real showtimes (International Showtimes API) for the chosen film's IMDb
// id near the picked theater's coordinates, and lets the host tap a slot to
// auto-fill the form. Doesn't fetch on mount — the API bills per request, so
// the host taps "Find Showtimes" to opt in.
export function ShowtimeSelector({ imdbId, lat, lng, date, onSelectShowtime }: Props) {
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [theaters, setTheaters] = useState<Theater[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const disabled = !imdbId || lat == null || lng == null;

  const handleFind = async () => {
    if (!imdbId || lat == null || lng == null) return;
    setLoading(true);
    const res = await fetchShowtimes(imdbId, lat, lng, date);
    setTheaters(res.theaters);
    setFetched(true);
    setLoading(false);
  };

  const handlePick = (
    theater: Theater,
    type: string,
    t: { time: string; bookingUrl?: string | null },
    key: string,
  ) => {
    setSelectedKey(key);
    onSelectShowtime({
      theaterName: theater.name,
      address: theater.address,
      showingType: type,
      time: t.time,
      bookingUrl: t.bookingUrl ?? undefined,
    });
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.findButton, disabled && styles.findButtonDisabled]}
        onPress={handleFind}
        disabled={disabled || loading}
        activeOpacity={0.85}
      >
        {loading ? (
          <ActivityIndicator color={SpaceTheme.backgroundVoid} />
        ) : (
          <>
            <Ionicons name="film-outline" size={18} color={SpaceTheme.backgroundVoid} />
            <Text style={styles.findButtonText}>
              {fetched ? "Refresh Showtimes" : "Find Showtimes"}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {disabled && !fetched && (
        <Text style={styles.hint}>Pick a movie and theater first to find showtimes.</Text>
      )}

      {fetched && !loading && theaters.length === 0 && (
        <Text style={styles.empty}>No showtimes found. Enter the time manually below.</Text>
      )}

      {theaters.map((theater, tIdx) => (
        <View key={`${theater.name}-${tIdx}`} style={styles.theaterCard}>
          <Text style={styles.theaterName}>{theater.name}</Text>
          {!!theater.address && <Text style={styles.theaterAddress}>{theater.address}</Text>}

          {theater.showings.map((showing, sIdx) => (
            <View key={`${showing.type}-${sIdx}`} style={styles.showingRow}>
              <Text style={styles.showingType}>{showing.type}</Text>
              <View style={styles.chipWrap}>
                {showing.times.map((t, i) => {
                  const key = `${tIdx}:${showing.type}:${t.time}:${i}`;
                  const active = selectedKey === key;
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => handlePick(theater, showing.type, t, key)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {formatIsoTime(t.time)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  findButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: SpaceTheme.accentGold,
    borderRadius: 12,
    paddingVertical: 12,
  },
  findButtonDisabled: { opacity: 0.45 },
  findButtonText: { color: SpaceTheme.backgroundVoid, fontSize: 15, fontWeight: "700" },
  hint: { color: SpaceTheme.mutedOrbit, fontSize: 13, textAlign: "center" },
  empty: { color: SpaceTheme.mutedOrbit, fontSize: 14, textAlign: "center", paddingVertical: 8 },
  theaterCard: {
    backgroundColor: SpaceTheme.nebulaCard,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  theaterName: { color: SpaceTheme.starWhite, fontSize: 15, fontWeight: "700" },
  theaterAddress: { color: SpaceTheme.mutedOrbit, fontSize: 12, marginTop: -6 },
  showingRow: { gap: 6 },
  showingType: {
    color: SpaceTheme.glowCyan,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: SpaceTheme.mutedOrbit,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  chipActive: { backgroundColor: SpaceTheme.accentGold, borderColor: SpaceTheme.accentGold },
  chipText: { color: SpaceTheme.starWhite, fontSize: 14 },
  chipTextActive: { color: SpaceTheme.backgroundVoid, fontWeight: "700" },
});
