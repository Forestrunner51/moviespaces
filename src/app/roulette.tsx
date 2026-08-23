import { useRef, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Text } from "@/frontend/components/scaled-text";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withRepeat,
  Easing,
  SharedValue,
} from "react-native-reanimated";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { MoviePoster } from "@/frontend/components/movie-poster";
import { ResultDot } from "@/frontend/components/result-dot";
import { SpaceTheme, SpaceStyles, Palette, Type, Radius, Display } from "@/frontend/constants/theme";
import {
  spinRoulette,
  gradeRouletteSpin,
  ROULETTE_GENRES,
  SpinResult,
  RouletteConnectionChallenge,
  RouletteChronosChallenge,
  RouletteCastDeductChallenge,
} from "@/frontend/services/roulette";
import { ChallengeResult, PuzzleMovie } from "@/frontend/services/cinemind";
import { useToast } from "@/frontend/components/toast";

type Phase = "picking" | "spinning" | "revealed" | "graded";

// Module-scope, not inline in the component: React Compiler can't verify
// Reanimated's mutable `.value` assignment is safe when it's inside a
// component closure, and flags it as an illegal mutation. Outside the
// component, it's just a function taking a SharedValue — nothing to analyze.
function resetReveal(reveal: SharedValue<number>) {
  reveal.value = 0;
}
function playReveal(reveal: SharedValue<number>) {
  reveal.value = withSpring(1, { damping: 12 });
}

// The wheel spins continuously (linear, no easing) while waiting on the
// network — an indefinite loop, not a fixed animation, since a real spin
// has no predetermined duration.
function startWheelSpin(wheel: SharedValue<number>) {
  wheel.value = withRepeat(
    withTiming(wheel.value + 360, { duration: 650, easing: Easing.linear }),
    -1,
    false,
  );
}
// Overrides the infinite repeat with a few more decelerating rotations that
// land on a clean multiple of 360 — the "it caught on something and slowed
// to a stop" motion an actual spin ends with, not an abrupt cut.
function settleWheelSpin(wheel: SharedValue<number>) {
  wheel.value = withTiming(wheel.value + 360 * 3, { duration: 1100, easing: Easing.out(Easing.cubic) });
}
function resetWheelSpin(wheel: SharedValue<number>) {
  wheel.value = 0;
}

// Movie Roulette — spin for a random film plus a one-off practice CineMind
// challenge about it. Explicitly NOT the daily game: nothing here touches a
// streak or a leaderboard, so it's safe to play any number of times, unlike
// the once-a-day puzzle at /cinemind.
export default function RouletteScreen() {
  const { showToast } = useToast();
  const [phase, setPhase] = useState<Phase>("picking");
  const [genre, setGenre] = useState<string | null>(null);
  const [spin, setSpin] = useState<SpinResult | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const [connectionAnswer, setConnectionAnswer] = useState<string | null>(null);
  const [chronosOrder, setChronosOrder] = useState<string[]>([]);
  const [castDeductAnswer, setCastDeductAnswer] = useState<string | null>(null);
  const [gradeResult, setGradeResult] = useState<ChallengeResult | null>(null);
  const grading = useRef(false);

  const reveal = useSharedValue(0);
  const revealStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ scale: 0.85 + reveal.value * 0.15 }],
  }));

  const wheel = useSharedValue(0);
  const wheelStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${wheel.value}deg` }],
  }));

  const resetAnswers = () => {
    setConnectionAnswer(null);
    setChronosOrder([]);
    setCastDeductAnswer(null);
    setGradeResult(null);
  };

  const handleSpin = async () => {
    setPhase("spinning");
    setErrorText(null);
    resetAnswers();
    resetReveal(reveal);
    startWheelSpin(wheel);
    try {
      const result = await spinRoulette(genre);
      setSpin(result);
      setPhase("revealed");
      settleWheelSpin(wheel);
      playReveal(reveal);
    } catch (err: any) {
      setErrorText(err?.message || "Couldn't spin. Please try again.");
      setPhase("picking");
      resetWheelSpin(wheel);
    }
  };

  const handleGrade = async () => {
    if (!spin || grading.current) return;
    grading.current = true;
    try {
      const result = await gradeRouletteSpin(spin.spinId, {
        connectionAnswer,
        chronosOrder: chronosOrder.length > 0 ? chronosOrder : null,
        castDeductAnswer,
      });
      setGradeResult(result);
      setPhase("graded");
    } catch (err: any) {
      showToast(err?.message || "Couldn't check that answer. Please try again.");
    } finally {
      grading.current = false;
    }
  };

  const handlePropose = () => {
    if (!spin) return;
    router.push({
      pathname: "/create-space",
      params: {
        spaceType: "public_gathering",
        movieName: spin.view.movie.title,
        posterPath: spin.view.movie.posterPath ?? "",
      },
    });
  };

  const challengeType = spin?.view.challengeType;
  const canCheck =
    (challengeType === "connection" && connectionAnswer != null) ||
    (challengeType === "castDeduct" && castDeductAnswer != null) ||
    (challengeType === "chronos" &&
      chronosOrder.length === (spin?.view.challenge as RouletteChronosChallenge)?.movies.length);

  return (
    <Starfield>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* No in-screen title: the navigation header already says
            "Movie Roulette" (see _layout.tsx), and repeating it doubled the
            heading — same cleanup create-space.tsx documents. */}
        <Text style={styles.subtitle}>Spin for a film, then take a shot at a practice challenge</Text>

        {(phase === "picking" || phase === "spinning") && (
          <>
            <Text style={styles.genreLabel}>Genre (optional)</Text>
            <View style={styles.genreRow}>
              <GenrePill label="Any" active={genre == null} onPress={() => setGenre(null)} />
              {ROULETTE_GENRES.map((g) => (
                <GenrePill key={g} label={g} active={genre === g} onPress={() => setGenre(g)} />
              ))}
            </View>

            {errorText && <Text style={styles.errorText}>{errorText}</Text>}

            {phase === "spinning" && (
              <View style={styles.wheelWrap}>
                <Animated.View style={wheelStyle}>
                  <Ionicons name="film" size={56} color={SpaceTheme.glowCyan} />
                </Animated.View>
                <Text style={styles.wheelLabel}>Spinning…</Text>
              </View>
            )}

            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.spinButton, phase === "spinning" && styles.spinButtonDisabled]}
              onPress={handleSpin}
              disabled={phase === "spinning"}
            >
              {phase === "spinning" ? (
                <ActivityIndicator color={SpaceTheme.backgroundVoid} />
              ) : (
                <>
                  <Ionicons name="shuffle" size={20} color={SpaceTheme.backgroundVoid} />
                  <Text style={styles.spinButtonText}>Spin</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}

        {spin && (phase === "revealed" || phase === "graded") && (
          <Animated.View style={revealStyle}>
            <View style={styles.revealCard}>
              <MoviePoster uri={spin.view.movie.posterPath} width={110} />
              <Text style={styles.revealTitle}>{spin.view.movie.title}</Text>
            </View>

            <ChallengeCard
              type={spin.view.challengeType}
              challenge={spin.view.challenge}
              locked={phase === "graded"}
              connectionAnswer={connectionAnswer}
              setConnectionAnswer={setConnectionAnswer}
              chronosOrder={chronosOrder}
              setChronosOrder={setChronosOrder}
              castDeductAnswer={castDeductAnswer}
              setCastDeductAnswer={setCastDeductAnswer}
            />

            {phase === "revealed" && (
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.spinButton, !canCheck && styles.spinButtonDisabled]}
                onPress={handleGrade}
                disabled={!canCheck}
              >
                <Text style={styles.spinButtonText}>Check Answer</Text>
              </TouchableOpacity>
            )}

            {phase === "graded" && gradeResult && (
              <View style={styles.resultBanner}>
                <View style={styles.resultBannerRow}>
                  <ResultDot correct={gradeResult.correct} style={styles.resultBannerDot} />
                  <Text style={styles.resultBannerText}>
                    {gradeResult.correct ? "Correct!" : "Not quite"}
                  </Text>
                </View>
                {!gradeResult.correct && gradeResult.correctAnswer && (
                  <Text style={styles.resultAnswerText}>Answer: {gradeResult.correctAnswer}</Text>
                )}
                <Text style={styles.practiceNote}>
                  Practice only — this doesn&apos;t affect your CineMind streak.
                </Text>
              </View>
            )}

            <View style={styles.actionsRow}>
              <TouchableOpacity activeOpacity={0.85} style={styles.secondaryButton} onPress={handleSpin}>
                <Ionicons name="shuffle" size={16} color={SpaceTheme.glowCyan} />
                <Text style={styles.secondaryButtonText}>Spin Again</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.85} style={styles.secondaryButton} onPress={handlePropose}>
                <Ionicons name="people-outline" size={16} color={SpaceTheme.accentGold} />
                <Text style={[styles.secondaryButtonText, { color: SpaceTheme.accentGold }]} numberOfLines={1}>
                  Propose Watch Party
                </Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}
      </ScrollView>
    </Starfield>
  );
}

function GenrePill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      style={[styles.genrePill, active && styles.genrePillActive]}
      onPress={onPress}
    >
      <Text style={[styles.genrePillText, active && styles.genrePillTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// The 1-question equivalent of the three challenge cards on /cinemind — same
// interaction patterns, deliberately, so a player already familiar with the
// daily game doesn't have to learn a second UI for practice mode.
function ChallengeCard({
  type,
  challenge,
  locked,
  connectionAnswer,
  setConnectionAnswer,
  chronosOrder,
  setChronosOrder,
  castDeductAnswer,
  setCastDeductAnswer,
}: {
  type: "connection" | "chronos" | "castDeduct";
  challenge: RouletteConnectionChallenge | RouletteChronosChallenge | RouletteCastDeductChallenge;
  locked: boolean;
  connectionAnswer: string | null;
  setConnectionAnswer: (v: string) => void;
  chronosOrder: string[];
  setChronosOrder: (fn: (prev: string[]) => string[]) => void;
  castDeductAnswer: string | null;
  setCastDeductAnswer: (v: string) => void;
}) {
  if (type === "connection") {
    const c = challenge as RouletteConnectionChallenge;
    return (
      <View style={styles.card}>
        <Text style={styles.challengeTitle}>The Connection</Text>
        <Text style={styles.challengeHint}>Which {c.linkKind} links all four of these films?</Text>
        <PosterRow movies={c.movies} />
        {c.options.map((option) => (
          <Option
            key={option}
            label={option}
            selected={connectionAnswer === option}
            disabled={locked}
            onPress={() => setConnectionAnswer(option)}
          />
        ))}
      </View>
    );
  }

  if (type === "castDeduct") {
    const c = challenge as RouletteCastDeductChallenge;
    return (
      <View style={styles.card}>
        <Text style={styles.challengeTitle}>Cast Deduct</Text>
        <Text style={styles.challengeHint}>Which actor appears in both of these films?</Text>
        <PosterRow movies={[c.movieA, c.movieB]} showTitles />
        {c.options.map((option) => (
          <Option
            key={option}
            label={option}
            selected={castDeductAnswer === option}
            disabled={locked}
            onPress={() => setCastDeductAnswer(option)}
          />
        ))}
      </View>
    );
  }

  const c = challenge as RouletteChronosChallenge;
  return (
    <View style={styles.card}>
      <Text style={styles.challengeTitle}>Chronos</Text>
      <Text style={styles.challengeHint}>Tap these in order of release — oldest first.</Text>
      {c.movies.map((movie) => {
        const position = chronosOrder.indexOf(movie.imdbId);
        return (
          <TouchableOpacity
            key={movie.imdbId}
            activeOpacity={0.8}
            disabled={locked}
            style={[styles.orderRow, position >= 0 && styles.orderRowSelected]}
            onPress={() =>
              setChronosOrder((prev) =>
                prev.includes(movie.imdbId)
                  ? prev.filter((id) => id !== movie.imdbId)
                  : [...prev, movie.imdbId],
              )
            }
          >
            <View style={[styles.orderBadge, position >= 0 && styles.orderBadgeActive]}>
              <Text style={[styles.orderBadgeText, position >= 0 && styles.orderBadgeTextActive]}>
                {position >= 0 ? position + 1 : "–"}
              </Text>
            </View>
            <MoviePoster uri={movie.posterPath} width={38} />
            <Text style={styles.orderTitle} numberOfLines={2}>
              {movie.title}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function PosterRow({ movies, showTitles }: { movies: PuzzleMovie[]; showTitles?: boolean }) {
  return (
    <View style={styles.posterRow}>
      {movies.map((movie) => (
        <View key={movie.imdbId} style={styles.posterCell}>
          <MoviePoster uri={movie.posterPath} width={64} />
          {showTitles && (
            <Text style={styles.posterTitle} numberOfLines={2}>
              {movie.title}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

function Option({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={disabled}
      style={[styles.option, selected && styles.optionSelected]}
      onPress={onPress}
    >
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={18}
        color={selected ? SpaceTheme.glowCyan : SpaceTheme.mutedOrbit}
      />
      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 20, paddingHorizontal: 16, paddingBottom: 40 },
  subtitle: {
    ...Type.small,
    color: SpaceTheme.mutedOrbit,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 20,
  },
  genreLabel: {
    ...Type.caption,
    color: SpaceTheme.mutedOrbit,
    textTransform: "uppercase",
    fontWeight: "700",
    marginBottom: 8,
  },
  genreRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  genrePill: {
    ...SpaceStyles.glassCard,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  genrePillActive: { borderColor: SpaceTheme.glowCyan, backgroundColor: Palette.accentDim },
  genrePillText: { color: SpaceTheme.mutedOrbit, ...Type.small, fontWeight: "600" },
  genrePillTextActive: { color: SpaceTheme.glowCyan, fontWeight: "700" },
  errorText: { color: SpaceTheme.danger, ...Type.small, textAlign: "center", marginBottom: 12 },
  wheelWrap: { alignItems: "center", marginBottom: 24, gap: 10 },
  wheelLabel: {
    color: SpaceTheme.mutedOrbit,
    ...Type.caption,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  spinButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: SpaceTheme.glowCyan,
    borderRadius: Radius.medium,
    paddingVertical: 16,
    marginTop: 4,
  },
  spinButtonDisabled: { opacity: 0.5 },
  spinButtonText: { color: SpaceTheme.backgroundVoid, ...Type.body, fontWeight: "700" },
  revealCard: { alignItems: "center", marginBottom: 20 },
  revealTitle: {
    ...Type.title,
    fontWeight: "800",
    color: SpaceTheme.starWhite,
    textAlign: "center",
    marginTop: 12,
  },
  card: { ...SpaceStyles.glassCard, padding: 16, marginBottom: 16 },
  challengeTitle: { ...Type.title, fontWeight: "700", color: SpaceTheme.starWhite },
  challengeHint: { ...Type.small, color: SpaceTheme.mutedOrbit, marginTop: 4, marginBottom: 14, lineHeight: 18 },
  posterRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16, justifyContent: "center" },
  posterCell: { alignItems: "center", width: 72 },
  posterTitle: { ...Type.caption, color: SpaceTheme.mutedOrbit, textAlign: "center", marginTop: 4 },
  option: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    marginBottom: 8,
  },
  optionSelected: { borderColor: SpaceTheme.glowCyan, backgroundColor: Palette.accentDim },
  optionText: { flex: 1, color: SpaceTheme.starWhite, ...Type.body },
  optionTextSelected: { fontWeight: "700" },
  orderRow: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    marginBottom: 8,
  },
  orderRowSelected: { borderColor: SpaceTheme.glowCyan },
  orderBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Palette.fillStrong,
  },
  orderBadgeActive: { backgroundColor: SpaceTheme.glowCyan },
  orderBadgeText: { color: SpaceTheme.mutedOrbit, ...Type.caption, fontWeight: "700" },
  orderBadgeTextActive: { color: SpaceTheme.backgroundVoid },
  orderTitle: { flex: 1, color: SpaceTheme.starWhite, ...Type.small },
  resultBanner: { alignItems: "center", marginBottom: 16 },
  resultBannerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  resultBannerDot: { width: 12, height: 12, borderRadius: Radius.pill },
  resultBannerText: { ...Type.title, fontWeight: "800", color: SpaceTheme.starWhite },
  resultAnswerText: { ...Type.small, color: SpaceTheme.mutedOrbit, marginTop: 4 },
  practiceNote: { ...Type.caption, color: SpaceTheme.mutedOrbit, marginTop: 8, fontStyle: "italic" },
  actionsRow: { flexDirection: "row", gap: 10, marginTop: 18 },
  secondaryButton: {
    ...SpaceStyles.glassCard,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
  },
  secondaryButtonText: { color: SpaceTheme.glowCyan, ...Type.small, fontWeight: "700" },
});
