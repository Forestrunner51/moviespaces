import { useState, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { Link } from "expo-router";
interface MovieSpace {
  id: number;
  title: string;
  description: string;
  createdAt: string;
}

const BACKEND_URL = "http://192.168.1.242:5123/api/moviespaces";

export default function Page() {
  // Form States
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Data States
  const [spaces, setSpaces] = useState<MovieSpace[]>([]);
  const [loading, setLoading] = useState(true);

  const BACKEND_URL = "http://localhost:5123/api/moviespaces";

  // Fetch spaces on load
  const fetchSpaces = async () => {
    try {
      const response = await fetch(BACKEND_URL);
      const data = await response.json();
      setSpaces(data);
    } catch (error) {
      console.error("Error fetching spaces:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSpaces();
  }, []);

  // Handle Form Submit
  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) return;

    setSubmitting(true);
    try {
      const response = await fetch(BACKEND_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, description }),
      });

      if (response.ok) {
        setTitle("");
        setDescription("");
        fetchSpaces(); // Refresh the list
      }
    } catch (error) {
      console.error("Error saving space:", error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>Movie Meetup Spaces</Text>

      {/* Input Form Section */}
      <View style={styles.formContainer}>
        <TextInput
          style={styles.input}
          placeholder="Enter Space Title..."
          value={title}
          onChangeText={setTitle}
          placeholderTextColor="#888"
        />
        <Link href="/theaters" asChild>
          <TouchableOpacity
            style={{
              backgroundColor: "#007AFF",
              padding: 14,
              borderRadius: 8,
              alignItems: "center",
              marginVertical: 10,
            }}
          >
            <Text style={{ color: "#FFF", fontWeight: "600" }}>
              📍 View Nearby Theaters
            </Text>
          </TouchableOpacity>
        </Link>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Enter Description..."
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
          placeholderTextColor="#888"
        />
        <TouchableOpacity
          style={styles.button}
          onPress={handleSubmit}
          disabled={submitting}
        >
          <Text style={styles.buttonText}>
            {submitting ? "Saving..." : "Create Space"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* List Section */}
      <Text style={styles.sectionTitle}>Active Spaces</Text>

      {loading ? (
        <ActivityIndicator
          size="large"
          color="#007AFF"
          style={{ marginTop: 20 }}
        />
      ) : (
        <FlatList
          data={spaces}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.listContainer}
          renderItem={({ item }) => (
            <View style={styles.spaceCard}>
              <Text style={styles.spaceTitle}>{item.title}</Text>
              <Text style={styles.spaceDescription}>{item.description}</Text>
              <Text style={styles.spaceDate}>
                {new Date(item.createdAt).toLocaleDateString()}
              </Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              No spaces created yet. Be the first!
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F9FA",
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#1A1A1A",
    marginBottom: 20,
  },
  formContainer: {
    backgroundColor: "#FFF",
    padding: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    marginBottom: 24,
  },
  input: {
    borderWidth: 1,
    borderColor: "#E5E5E5",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: "#FAFAFA",
    marginBottom: 12,
    color: "#000",
  },
  textArea: {
    height: 80,
    textAlignVertical: "top",
  },
  button: {
    backgroundColor: "#007AFF",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1A1A1A",
    marginBottom: 12,
  },
  listContainer: {
    paddingBottom: 40,
  },
  spaceCard: {
    backgroundColor: "#FFF",
    padding: 16,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#EAEAEA",
  },
  spaceTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 4,
  },
  spaceDescription: {
    fontSize: 14,
    color: "#666",
    marginBottom: 8,
    lineHeight: 20,
  },
  spaceDate: {
    fontSize: 12,
    color: "#999",
    textAlign: "right",
  },
  emptyText: {
    textAlign: "center",
    color: "#888",
    marginTop: 20,
    fontSize: 16,
  },
});
