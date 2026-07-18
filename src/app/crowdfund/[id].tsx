import { useCallback, useState } from "react";
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams, useFocusEffect, Stack, router } from "expo-router";
import { CardField, useStripe } from "@stripe/stripe-react-native";
import {
  getSpace,
  createPledge,
  cancelSpace,
  CrowdfundSpace,
} from "@/frontend/hooks/use-crowdfund-spaces";
import { useSpaceInterest } from "@/frontend/hooks/use-space-interest";
import { supabase } from "@/frontend/config/supabase";

export default function CrowdfundDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { confirmPayment } = useStripe();
  const { interestedCount, isInterested, markInterested, removeInterest } =
    useSpaceInterest(id);

  const [space, setSpace] = useState<CrowdfundSpace | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [pledgeModalVisible, setPledgeModalVisible] = useState(false);
  const [pledgeAmount, setPledgeAmount] = useState("");
  const [cardComplete, setCardComplete] = useState(false);
  const [pledging, setPledging] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getSpace(id);
      setSpace(data);
    } catch (err) {
      console.error("Failed to load crowdfund space:", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
      const interval = setInterval(load, 5000);
      return () => clearInterval(interval);
    }, [load]),
  );

  useFocusEffect(
    useCallback(() => {
      supabase.auth.getUser().then(({ data: { user } }) => {
        setCurrentUserId(user?.id ?? null);
      });
    }, []),
  );

  const handlePledge = async () => {
    const amount = parseFloat(pledgeAmount);
    if (!amount || amount <= 0) {
      Alert.alert("Enter an amount", "Pledge amount must be greater than zero.");
      return;
    }
    if (!cardComplete) {
      Alert.alert("Card required", "Please enter your card details.");
      return;
    }

    setPledging(true);
    try {
      const { clientSecret } = await createPledge(id, amount);
      const { error } = await confirmPayment(clientSecret, { paymentMethodType: "Card" });
      if (error) {
        Alert.alert("Payment failed", error.message);
        return;
      }
      setPledgeModalVisible(false);
      setPledgeAmount("");
      await load();
    } catch (err: any) {
      Alert.alert("Couldn't pledge", err.message || "Please try again.");
    } finally {
      setPledging(false);
    }
  };

  const handleCancel = () => {
    Alert.alert("Cancel this space?", "Any authorized pledges will be released.", [
      { text: "Never mind", style: "cancel" },
      {
        text: "Cancel space",
        style: "destructive",
        onPress: async () => {
          try {
            await cancelSpace(id);
            await load();
          } catch (err: any) {
            Alert.alert("Couldn't cancel", err.message || "Please try again.");
          }
        },
      },
    ]);
  };

  if (loading || !space) {
    return <ActivityIndicator size="large" style={{ flex: 1, backgroundColor: "#111" }} />;
  }

  const progress = Math.min(space.currentAmount / space.targetAmount, 1);
  const isCreator = currentUserId === space.creatorId;
  const alreadyPledged = space.pledges.some((p) => p.userId === currentUserId);

  return (
    <ScrollView style={styles.container}>
      <Stack.Screen options={{ title: space.movieTitle }} />

      {space.moviePosterUrl && (
        <Image source={{ uri: space.moviePosterUrl }} style={styles.poster} />
      )}
      <Text style={styles.title}>{space.movieTitle}</Text>
      <Text style={styles.subtitle}>
        {space.theaterName} • {new Date(space.showtime).toLocaleString()}
      </Text>

      <View style={styles.statusBadge}>
        <Text style={styles.statusText}>{space.status.toUpperCase()}</Text>
      </View>

      <View style={styles.progressSection}>
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.progressText}>
          ${space.currentAmount.toFixed(2)} of ${space.targetAmount.toFixed(2)} pledged
        </Text>
        <Text style={styles.deadlineText}>
          Deadline: {new Date(space.deadline).toLocaleString()}
        </Text>
        {space.maxParticipants && (
          <Text style={styles.deadlineText}>
            {space.pledges.length} / {space.maxParticipants} spots filled
          </Text>
        )}
        <Text style={styles.deadlineText}>{interestedCount} interested</Text>
      </View>

      {(isCreator || alreadyPledged) && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.chatButton}
            onPress={() =>
              router.push({
                pathname: "/group-chat/[id]",
                params: { id: space.id, type: "crowdfund", title: space.movieTitle },
              })
            }
          >
            <Text style={styles.chatButtonText}>💬 Group Chat</Text>
          </TouchableOpacity>
        </View>
      )}

      {space.status === "funding" && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, isInterested && styles.actionButtonActive]}
            onPress={() => (isInterested ? removeInterest() : markInterested())}
          >
            <Text style={styles.actionButtonText}>
              {isInterested ? "✓ Interested" : "I'm interested"}
            </Text>
          </TouchableOpacity>

          {!alreadyPledged && (
            <TouchableOpacity
              style={styles.pledgeButton}
              onPress={() => setPledgeModalVisible(true)}
            >
              <Text style={styles.pledgeButtonText}>Pledge money</Text>
            </TouchableOpacity>
          )}

          {isCreator && (
            <TouchableOpacity style={styles.cancelLink} onPress={handleCancel}>
              <Text style={styles.cancelLinkText}>Cancel this space</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {(isCreator || alreadyPledged) && space.pledges.length > 0 && (
        <View style={styles.pledgeList}>
          <Text style={styles.pledgeListTitle}>Pledges</Text>
          {space.pledges.map((p) => (
            <View key={p.id} style={styles.pledgeRow}>
              <Text style={styles.pledgeRowText}>${p.pledgeAmount.toFixed(2)}</Text>
              <Text style={styles.pledgeRowStatus}>{p.status}</Text>
            </View>
          ))}
        </View>
      )}

      <Modal
        visible={pledgeModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPledgeModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Pledge to this space</Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setPledgeModalVisible(false)}
              >
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <TextInput
                style={styles.input}
                placeholder="Amount ($)"
                placeholderTextColor="#888"
                value={pledgeAmount}
                onChangeText={setPledgeAmount}
                keyboardType="decimal-pad"
              />
              <CardField
                postalCodeEnabled={false}
                style={styles.cardField}
                cardStyle={{ backgroundColor: "#222", textColor: "#fff" }}
                onCardChange={(details) => setCardComplete(details.complete)}
              />
              <TouchableOpacity
                style={styles.createButton}
                onPress={handlePledge}
                disabled={pledging}
              >
                {pledging ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Authorize pledge</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111" },
  poster: { width: "100%", height: 240, backgroundColor: "#222" },
  title: { color: "#fff", fontSize: 22, fontWeight: "bold", padding: 16, paddingBottom: 4 },
  subtitle: { color: "#888", fontSize: 14, paddingHorizontal: 16 },
  statusBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#222",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginHorizontal: 16,
    marginTop: 12,
  },
  statusText: { color: "#3c87f7", fontSize: 12, fontWeight: "700" },
  progressSection: { padding: 16 },
  progressBarBg: { height: 10, backgroundColor: "#222", borderRadius: 5, overflow: "hidden" },
  progressBarFill: { height: "100%", backgroundColor: "#E50914" },
  progressText: { color: "#fff", fontSize: 15, fontWeight: "600", marginTop: 8 },
  deadlineText: { color: "#888", fontSize: 13, marginTop: 4 },
  actions: { paddingHorizontal: 16, gap: 10, marginTop: 8 },
  chatButton: {
    backgroundColor: "#5856D6",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  chatButtonText: { color: "#fff", fontWeight: "bold", fontSize: 16 },
  actionButton: {
    backgroundColor: "#222",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  actionButtonActive: { backgroundColor: "#2E5A3E" },
  actionButtonText: { color: "#fff", fontWeight: "600" },
  pledgeButton: {
    backgroundColor: "#E50914",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  pledgeButtonText: { color: "#fff", fontWeight: "bold", fontSize: 16 },
  cancelLink: { alignItems: "center", padding: 8 },
  cancelLinkText: { color: "#ff5c5c", fontSize: 14 },
  pledgeList: { padding: 16 },
  pledgeListTitle: { color: "#888", fontSize: 13, fontWeight: "700", marginBottom: 8 },
  pledgeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#1a1a1a",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  pledgeRowText: { color: "#fff", fontSize: 15 },
  pledgeRowStatus: { color: "#888", fontSize: 13, textTransform: "capitalize" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modal: {
    backgroundColor: "#111",
    padding: 24,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "85%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#222",
    alignItems: "center",
    justifyContent: "center",
  },
  closeButtonText: { fontSize: 16, color: "#ccc", fontWeight: "600" },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "bold" },
  input: {
    backgroundColor: "#222",
    color: "#fff",
    padding: 14,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 12,
  },
  cardField: { height: 50, marginBottom: 16 },
  createButton: {
    backgroundColor: "#E50914",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
});
