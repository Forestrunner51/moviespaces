import { useState, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Image,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { authFetch } from "../../frontend/services/api";
import { Starfield } from "@/frontend/components/starfield";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";

interface Film {
  film_id: number;
  film_name: string;
  synopsis_long: string;
  images: {
    poster: {
      1: {
        medium: {
          film_image: string;
        };
      };
    };
  };
}

export default function HomeScreen() {
  const { mode: initialMode } = useLocalSearchParams<{ mode?: "movies" }>();
  const [mode, setMode] = useState<"choose" | "movies">(
    initialMode === "movies" ? "movies" : "choose",
  );
  const [films, setFilms] = useState<Film[]>([]);
  const [filtered, setFiltered] = useState<Film[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (mode !== "movies") return;
    authFetch(`${process.env.EXPO_PUBLIC_API_URL}/api/movieglu/films`)
      .then(async (res) => {
        // 1. Check if the server actually sent back a successful status code
        if (!res.ok) {
          throw new Error(`Server responded with status: ${res.status}`);
        }

        // 2. Read the raw text first to guarantee it isn't an empty string
        const rawText = await res.text();
        if (!rawText.trim()) {
          return { films: [] }; // Return a clean empty state fallback if response text is blank
        }

        return JSON.parse(rawText);
      })
      .then((data) => {
        setFilms(data.films || []);
        setFiltered(data.films || []);
        setLoading(false);
      })
      .catch((err) => {
        console.warn("⚠️ Data Fetch bypassed or unauthorized:", err.message);
        // Fallback: stop loading spinner and leave array empty so user can click 'Sign In'
        setFilms([]);
        setFiltered([]);
        setLoading(false);
      });
  }, [mode]);

  useEffect(() => {
    if (!search.trim()) {
      setFiltered(films);
    } else {
      setFiltered(
        films.filter((f) =>
          f.film_name.toLowerCase().includes(search.toLowerCase()),
        ),
      );
    }
  }, [search, films]);

  if (mode === "choose") {
    return (
      <Starfield>
        <View style={styles.container}>
          <Text style={[styles.title, SpaceStyles.glowText, styles.titleSpacing]}>MovieSpace</Text>
          <Text style={styles.chooseSubtitle}>What do you want to do?</Text>

          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.chooseCard}
            onPress={() => setMode("movies")}
          >
            <Ionicons name="film-outline" size={28} color={SpaceTheme.glowCyan} />
            <View style={{ flex: 1 }}>
              <Text style={styles.chooseCardTitle}>Watch a Movie</Text>
              <Text style={styles.chooseCardSubtitle}>
                Browse what's currently in theaters and start a Space with friends
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={SpaceTheme.mutedOrbit} />
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.chooseCard}
            onPress={() => router.push("/rent-a-theater")}
          >
            <Ionicons name="storefront-outline" size={28} color={SpaceTheme.supernovaPink} />
            <View style={{ flex: 1 }}>
              <Text style={styles.chooseCardTitle}>Rent a Theater</Text>
              <Text style={styles.chooseCardSubtitle}>
                Find a nearby theater and arrange your own private rental
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={SpaceTheme.mutedOrbit} />
          </TouchableOpacity>
        </View>
      </Starfield>
    );
  }

  if (loading) {
    return (
      <Starfield>
        <ActivityIndicator size="large" color={SpaceTheme.glowCyan} style={{ flex: 1 }} />
      </Starfield>
    );
  }

  return (
    <Starfield>
      <View style={styles.container}>
        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.backRow}
          onPress={() => setMode("choose")}
        >
          <Ionicons name="chevron-back" size={18} color={SpaceTheme.mutedOrbit} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, SpaceStyles.glowText, styles.titleSpacing]}>MovieSpace</Text>

        <TextInput
          style={styles.search}
          placeholder="Search for a movie..."
          value={search}
          onChangeText={setSearch}
          placeholderTextColor={SpaceTheme.mutedOrbit}
        />
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.film_id.toString()}
          renderItem={({ item }) => (
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.card}
              onPress={() =>
                router.push({
                  pathname: "/movie",
                  params: {
                    filmId: item.film_id,
                    filmName: item.film_name,
                    posterUrl:
                      item.images?.poster?.["1"]?.medium?.film_image ?? "",
                  },
                })
              }
            >
              <Image
                source={{ uri: item.images?.poster?.["1"]?.medium?.film_image }}
                style={styles.poster}
              />
              <View style={styles.info}>
                <Text style={styles.filmName}>{item.film_name}</Text>
                <Text style={styles.synopsis} numberOfLines={2}>
                  {item.synopsis_long?.replace(/<[^>]*>/g, "")}
                </Text>
                <Text style={styles.cta}>View Spaces & Showtimes →</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: SpaceTheme.starWhite,
  },
  titleSpacing: { marginBottom: 16 },
  chooseSubtitle: { fontSize: 15, color: SpaceTheme.mutedOrbit, marginBottom: 20 },
  chooseCard: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 18,
    marginBottom: 16,
  },
  chooseCardTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: SpaceTheme.starWhite,
    marginBottom: 4,
  },
  chooseCardSubtitle: { fontSize: 13, color: SpaceTheme.mutedOrbit, lineHeight: 18 },
  backRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  backText: { fontSize: 14, color: SpaceTheme.mutedOrbit, fontWeight: "600" },
  search: {
    ...SpaceStyles.glassCard,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
    color: SpaceTheme.starWhite,
  },
  card: {
    ...SpaceStyles.glassCard,
    marginBottom: 16,
    flexDirection: "row",
    overflow: "hidden",
  },
  poster: { width: 90, height: 130 },
  info: { flex: 1, padding: 12, justifyContent: "space-between" },
  filmName: {
    fontSize: 16,
    fontWeight: "700",
    color: SpaceTheme.starWhite,
    marginBottom: 4,
  },
  synopsis: { fontSize: 13, color: SpaceTheme.mutedOrbit, lineHeight: 18, flex: 1 },
  cta: { fontSize: 13, color: SpaceTheme.glowCyan, fontWeight: "600", marginTop: 8 },
});
