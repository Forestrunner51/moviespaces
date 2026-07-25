import { useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SpaceTheme } from "@/frontend/constants/theme";
import { fetchShowtimes, SelectedShowtime, Theater } from "@/frontend/services/showtimes";

interface Props {
  movieTitle: string;
  location: string;
  onSelectShowtime: (selected: SelectedShowtime) => void;
}

// Lets a host pull real, verified showtimes for the film + location and tap a
// slot to auto-fill the create-space form (theater + time), instead of hand-
// dialing the time picker. Deliberately does NOT fetch on mount — SerpApi
// bills per search, so the host taps "Find Showtimes" to opt in.
export function ShowtimeSelector({ movieTitle, location, onSelectShowtime }: Props) {
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [theaters, setTheaters] = useState<Theater[]>([]);
  // Which chip is highlighted, as "theaterIdx:type:time" so the same time
  // under two formats (Standard vs IMAX) highlight independently.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const disabled = !movieTitle.trim() || !location.trim();

  const handleFind = async () => {
    setLoading(true);
    const res = await fetchShowtimes(movieTitle, location);
    setTheaters(res.theaters);
    setFetched(true);
    setLoading(false);
  };

  const handlePick = (theater: Theater, type: string, time: string, key: string) => {
    setSelectedKey(key);
    onSelectShowtime({
      theaterName: theater.name,
      address: theater.address,
      showingType: type,
      time,
      ticketUrl: theater.ticketUrl || undefined,
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
              {fetched ? "Refresh Showtimes" : "Find Showtimes Near Me"}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {disabled && !fetched && (
        <Text style={styles.hint}>Pick a {"movie"} and theater first to find showtimes.</Text>
      )}

      {/* Empty state — SerpApi came back with nothing (or failed); the host
          can still enter the time manually below in the form. */}
      {fetched && !loading && theaters.length === 0 && (
        <Text style={styles.empty}>No direct showtimes found. Enter manually below.</Text>
      )}

      {theaters.map((theater, tIdx) => (
        <View key={`${theater.name}-${tIdx}`} style={styles.theaterCard}>
          <Text style={styles.theaterName}>{theater.name}</Text>
          {!!theater.address && <Text style={styles.theaterAddress}>{theater.address}</Text>}

          {theater.showings.map((showing, sIdx) => (
            <View key={`${showing.type}-${sIdx}`} style={styles.showingRow}>
              <Text style={styles.showingType}>{showing.type}</Text>
              <View style={styles.chipWrap}>
                {showing.times.map((time, i) => {
                  const key = `${tIdx}:${showing.type}:${time}:${i}`;
                  const active = selectedKey === key;
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => handlePick(theater, showing.type, time, key)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {time}
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
  container: {
    gap: 10,
  },
  findButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: SpaceTheme.accentGold,
    borderRadius: 12,
    paddingVertical: 12,
  },
  findButtonDisabled: {
    opacity: 0.45,
  },
  findButtonText: {
    color: SpaceTheme.backgroundVoid,
    fontSize: 15,
    fontWeight: "700",
  },
  hint: {
    color: SpaceTheme.mutedOrbit,
    fontSize: 13,
    textAlign: "center",
  },
  empty: {
    color: SpaceTheme.mutedOrbit,
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 8,
  },
  theaterCard: {
    backgroundColor: SpaceTheme.nebulaCard,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  theaterName: {
    color: SpaceTheme.starWhite,
    fontSize: 15,
    fontWeight: "700",
  },
  theaterAddress: {
    color: SpaceTheme.mutedOrbit,
    fontSize: 12,
    marginTop: -6,
  },
  showingRow: {
    gap: 6,
  },
  showingType: {
    color: SpaceTheme.glowCyan,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: SpaceTheme.mutedOrbit,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  chipActive: {
    backgroundColor: SpaceTheme.accentGold,
    borderColor: SpaceTheme.accentGold,
  },
  chipText: {
    color: SpaceTheme.starWhite,
    fontSize: 14,
  },
  chipTextActive: {
    color: SpaceTheme.backgroundVoid,
    fontWeight: "700",
  },
});
