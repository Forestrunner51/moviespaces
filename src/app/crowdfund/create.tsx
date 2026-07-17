import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { router } from "expo-router";
import {
  searchMovies,
  createSpace,
  TmdbMovie,
} from "@/frontend/hooks/use-crowdfund-spaces";

export default function CreateCrowdfundScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TmdbMovie[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedMovie, setSelectedMovie] = useState<TmdbMovie | null>(null);

  const [theaterName, setTheaterName] = useState("");
  const [showtime, setShowtime] = useState(""); // ISO string, simple text input for MVP
  const [deadline, setDeadline] = useState(""); // ISO string
  const [targetAmount, setTargetAmount] = useState("");
  const [maxParticipants, setMaxParticipants] = useState("");
  const [creating, setCreating] = useState(false);

  const handleSearch = async (text: string) => {
    setQuery(text);
    if (!text.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const found = await searchMovies(text);
    setResults(found);
    setSearching(false);
  };

  const handleCreate = async () => {
    if (!selectedMovie) return;
    if (!theaterName.trim() || !showtime || !deadline || !targetAmount) {
      Alert.alert("Missing info", "Please fill in theater, showtime, deadline, and target amount.");
      return;
    }

    setCreating(true);
    try {
      const spaceId = await createSpace({
        movieId: selectedMovie.id.toString(),
        movieTitle: selectedMovie.title,
        moviePosterUrl: selectedMovie.posterPath
          ? `https://image.tmdb.org/t/p/w342${selectedMovie.posterPath}`
          : null,
        theaterId: theaterName.trim(),
        theaterName: theaterName.trim(),
        showtime: new Date(showtime).toISOString(),
        targetAmount: parseFloat(targetAmount),
        deadline: new Date(deadline).toISOString(),
        maxParticipants: maxParticipants ? parseInt(maxParticipants, 10) : null,
      });
      router.replace({ pathname: "/crowdfund/[id]", params: { id: spaceId } });
    } catch (err: any) {
      Alert.alert("Couldn't create space", err.message || "Please try again.");
    } finally {
      setCreating(false);
    }
  };

  if (selectedMovie) {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => setSelectedMovie(null)}>
          <Text style={styles.backLink}>← Choose a different movie</Text>
        </TouchableOpacity>

        <View style={styles.selectedMovieRow}>
          {selectedMovie.posterPath && (
            <Image
              source={{ uri: `https://image.tmdb.org/t/p/w92${selectedMovie.posterPath}` }}
              style={styles.poster}
            />
          )}
          <Text style={styles.movieTitle}>{selectedMovie.title}</Text>
        </View>

        <TextInput
          style={styles.input}
          placeholder="Theater name"
          placeholderTextColor="#888"
          value={theaterName}
          onChangeText={setTheaterName}
        />
        <TextInput
          style={styles.input}
          placeholder="Showtime (e.g. 2026-08-01T20:00:00)"
          placeholderTextColor="#888"
          value={showtime}
          onChangeText={setShowtime}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="Pledge deadline (e.g. 2026-07-30T20:00:00)"
          placeholderTextColor="#888"
          value={deadline}
          onChangeText={setDeadline}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="Target amount ($)"
          placeholderTextColor="#888"
          value={targetAmount}
          onChangeText={setTargetAmount}
          keyboardType="decimal-pad"
        />
        <TextInput
          style={styles.input}
          placeholder="Max participants (optional — leave blank for uncapped)"
          placeholderTextColor="#888"
          value={maxParticipants}
          onChangeText={setMaxParticipants}
          keyboardType="number-pad"
        />

        <TouchableOpacity
          style={styles.createButton}
          onPress={handleCreate}
          disabled={creating}
        >
          {creating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Create Crowdfund</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pick a movie</Text>
      <TextInput
        style={styles.input}
        placeholder="Search TMDB..."
        placeholderTextColor="#888"
        value={query}
        onChangeText={handleSearch}
      />
      {searching && <ActivityIndicator style={{ marginTop: 12 }} />}
      <FlatList
        data={results}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.resultRow} onPress={() => setSelectedMovie(item)}>
            {item.posterPath && (
              <Image
                source={{ uri: `https://image.tmdb.org/t/p/w92${item.posterPath}` }}
                style={styles.poster}
              />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.movieTitle}>{item.title}</Text>
              {item.releaseDate && <Text style={styles.releaseDate}>{item.releaseDate}</Text>}
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111", padding: 16, paddingTop: 24 },
  title: { fontSize: 22, fontWeight: "bold", color: "#fff", marginBottom: 16 },
  backLink: { color: "#3c87f7", fontSize: 14, marginBottom: 16 },
  input: {
    backgroundColor: "#222",
    color: "#fff",
    padding: 14,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 12,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  poster: { width: 46, height: 69, borderRadius: 6, backgroundColor: "#333" },
  movieTitle: { color: "#fff", fontSize: 16, fontWeight: "600" },
  releaseDate: { color: "#888", fontSize: 13, marginTop: 2 },
  selectedMovieRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  createButton: {
    backgroundColor: "#E50914",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
});
