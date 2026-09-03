import { useRef, useState } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { Text } from "@/frontend/components/scaled-text";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { Palette, Type, Display, Radius } from "@/frontend/constants/theme";
import { completeOnboarding } from "@/frontend/services/onboarding";

// The 60-second tour: one card per surface, in the order a first night out
// actually uses them. Reached two ways — the tail of onboarding (finishing
// routes into the app) and Settings' "App Tour" row (finishing goes back).
const PAGES: {
  icon: keyof typeof Ionicons.glyphMap;
  kicker: string;
  title: string;
  body: string;
}[] = [
  {
    icon: "people",
    kicker: "MOVIE CREW",
    title: "Never see a film alone.",
    body: "Pick a real showing near you and you're grouped with up to 5 others going to it. Chat opens instantly — plan seats, meet in the lobby.",
  },
  {
    icon: "home",
    kicker: "SPACES",
    title: "Host your own movie night.",
    body: "A screening at a theater or a watch party at your place. Friends or anyone nearby can join, RSVP, and split the cost. Lock it with an invite code if you want.",
  },
  {
    icon: "chatbubbles",
    kicker: "COMMUNITY CLUBS",
    title: "Rooms full of movie people.",
    body: "Genre clubs and local clubs — just members and chat, always open. It's where you find your people, and crews start one tap away.",
  },
  {
    icon: "bulb",
    kicker: "CINEMIND",
    title: "One puzzle. Every day.",
    body: "Four quick movie challenges a day, with streaks and club leaderboards. Resets at midnight — bragging rights don't.",
  },
  {
    icon: "person-circle",
    kicker: "YOUR PROFILE",
    title: "Taste is identity.",
    body: "Your top 3, your bottom 3, films seen, crews joined. It's how a crew knows who they're watching with.",
  },
];

export default function TourScreen() {
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  const isOnboarding = onboarding === "1";
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const p = Math.round(e.nativeEvent.contentOffset.x / width);
    if (p !== page) setPage(p);
  };

  const finish = async () => {
    if (isOnboarding) await completeOnboarding();
    else if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const next = () => {
    if (page >= PAGES.length - 1) {
      finish();
      return;
    }
    scrollRef.current?.scrollTo({ x: (page + 1) * width, animated: true });
  };

  return (
    <Starfield>
      <View style={styles.container}>
        <TouchableOpacity onPress={finish} hitSlop={10} style={styles.skip} accessibilityRole="button">
          <Text style={styles.skipText}>{isOnboarding ? "Skip" : "Close"}</Text>
        </TouchableOpacity>

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={32}
        >
          {PAGES.map((p) => (
            <View key={p.kicker} style={[styles.page, { width }]}>
              <View style={styles.iconWrap}>
                <Ionicons name={p.icon} size={40} color={Palette.accent} />
              </View>
              <Text style={styles.kicker}>{p.kicker}</Text>
              <Text style={styles.title}>{p.title}</Text>
              <Text style={styles.body}>{p.body}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={styles.dots}>
          {PAGES.map((_, i) => (
            <View key={i} style={[styles.dot, i === page && styles.dotOn]} />
          ))}
        </View>

        <TouchableOpacity activeOpacity={0.85} style={styles.button} onPress={next} accessibilityRole="button">
          <Text style={styles.buttonText}>
            {page >= PAGES.length - 1 ? (isOnboarding ? "Let's go 🎬" : "Done") : "Next"}
          </Text>
        </TouchableOpacity>
      </View>
    </Starfield>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingBottom: 40 },
  skip: { position: "absolute", top: 62, right: 22, zIndex: 2, padding: 4 },
  skipText: { ...Type.small, color: Palette.textMuted, fontWeight: "600" },
  page: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 36 },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Palette.accentDim,
    borderWidth: 1,
    borderColor: Palette.accentBorder,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
  },
  kicker: { ...Display.section, fontSize: 14, letterSpacing: 3, color: Palette.accent, marginBottom: 8 },
  title: { ...Display.heading, color: Palette.text, textAlign: "center", marginBottom: 12 },
  body: { ...Type.body, color: Palette.textMuted, textAlign: "center", lineHeight: 23 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 7, marginBottom: 18 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Palette.border },
  dotOn: { backgroundColor: Palette.accent, width: 18 },
  button: {
    marginHorizontal: 24,
    backgroundColor: Palette.accent,
    borderRadius: Radius.medium,
    paddingVertical: 15,
    alignItems: "center",
  },
  buttonText: { ...Type.body, color: Palette.base, fontWeight: "700" },
});
