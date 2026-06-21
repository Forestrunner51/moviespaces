import { useState, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Image,
} from "react-native";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

const GENRES = [
  { id: 1, name: "Drama", emoji: "🎭" },
  { id: 2, name: "Thriller", emoji: "😱" },
  { id: 3, name: "Comedy", emoji: "😂" },
  { id: 4, name: "Romance", emoji: "❤️" },
  { id: 5, name: "Action/Adventure", emoji: "💥" },
  { id: 6, name: "Horror", emoji: "👻" },
  { id: 7, name: "Sci-Fi", emoji: "🚀" },
  { id: 8, name: "Documentary", emoji: "🎥" },
  { id: 9, name: "International", emoji: "🌍" },
];

interface Film {
  film_id: number;
  film_name: string;
  synopsis_long: string;
  release_dates: { release_date: string }[];
  images: {
    poster: {
      1: { medium: { film_image: string } };
    };
  };
  age_rating: { rating: string }[];
}

export default function ExploreScreen() {
  const [selectedGenres, setSelectedGenres] = useState<number[]>([]);
  const [films, setFilms] = useState<Film[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGenrePicker, setShowGenrePicker] = useState(false);

  useEffect(() => {
    loadGenres();
    fetchFilms();
  }, []);

  const loadGenres = async () => {
    const saved = await AsyncStorage.getItem("selectedGenres");
    if (saved) setSelectedGenres(JSON.parse(saved));
    else setShowGenrePicker(true); // show picker on first visit
  };

  const fetchFilms = async () => {
    const res = await fetch(
      `${process.env.EXPO_PUBLIC_API_URL}/api/movieglu/filmssoon`,
    );
    const data = await res.json();
    setFilms(data.films || []);
    setLoading(false);
  };

  const toggleGenre = (id: number) => {
    setSelectedGenres((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id],
    );
  };

  const saveGenres = async () => {
    await AsyncStorage.setItem(
      "selectedGenres",
      JSON.stringify(selectedGenres),
    );
    setShowGenrePicker(false);
  };

  if (showGenrePicker) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>What do you like? 🎬</Text>
        <Text style={styles.subtitle}>
          Pick your favourite genres and we'll recommend films for you.
        </Text>
        <View style={styles.genreGrid}>
          {GENRES.map((genre) => (
            <TouchableOpacity
              key={genre.id}
              style={[
                styles.genreChip,
                selectedGenres.includes(genre.id) && styles.genreChipSelected,
              ]}
              onPress={() => toggleGenre(genre.id)}
            >
              <Text style={styles.genreEmoji}>{genre.emoji}</Text>
              <Text
                style={[
                  styles.genreName,
                  selectedGenres.includes(genre.id) && styles.genreNameSelected,
                ]}
              >
                {genre.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          style={[
            styles.saveButton,
            selectedGenres.length === 0 && styles.disabled,
          ]}
          onPress={saveGenres}
          disabled={selectedGenres.length === 0}
        >
          <Text style={styles.saveButtonText}>See Recommendations</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading) return <ActivityIndicator size="large" style={{ flex: 1 }} />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Coming Soon 🍿</Text>
        <TouchableOpacity onPress={() => setShowGenrePicker(true)}>
          <Text style={styles.editGenres}>Edit Taste</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.subtitle}>
        Based on your taste:{" "}
        {selectedGenres
          .map((id) => GENRES.find((g) => g.id === id)?.emoji)
          .join(" ")}
      </Text>
      <FlatList
        data={films}
        keyExtractor={(item) => item.film_id.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity
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
              <Text style={styles.releaseDate}>
                📅 {item.release_dates?.[0]?.release_date}
              </Text>
              <Text style={styles.rating}>{item.age_rating?.[0]?.rating}</Text>
              <Text style={styles.synopsis} numberOfLines={2}>
                {item.synopsis_long?.replace(/<[^>]*>/g, "")}
              </Text>
              <Text style={styles.cta}>View Spaces & Showtimes →</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No films coming soon right now.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  title: { fontSize: 28, fontWeight: "bold", color: "#1A1A1A" },
  subtitle: { fontSize: 14, color: "#666", marginBottom: 16 },
  editGenres: { color: "#007AFF", fontWeight: "600" },
  genreGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 24,
  },
  genreChip: {
    width: "45%",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#E5E5E5",
  },
  genreChipSelected: { borderColor: "#007AFF", backgroundColor: "#EBF5FF" },
  genreEmoji: { fontSize: 28, marginBottom: 8 },
  genreName: { fontSize: 14, fontWeight: "600", color: "#333" },
  genreNameSelected: { color: "#007AFF" },
  saveButton: {
    backgroundColor: "#007AFF",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  saveButtonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  disabled: { backgroundColor: "#ccc" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    marginBottom: 16,
    flexDirection: "row",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  poster: { width: 90, height: 130 },
  info: { flex: 1, padding: 12 },
  filmName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1A1A1A",
    marginBottom: 4,
  },
  releaseDate: { fontSize: 12, color: "#666", marginBottom: 2 },
  rating: { fontSize: 12, color: "#999", marginBottom: 4 },
  synopsis: { fontSize: 13, color: "#666", lineHeight: 18 },
  cta: { fontSize: 13, color: "#007AFF", fontWeight: "600", marginTop: 8 },
  empty: { textAlign: "center", color: "#888", marginTop: 40, fontSize: 16 },
});
