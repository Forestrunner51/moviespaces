import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Share,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { MoviePoster } from "@/frontend/components/movie-poster";
import { LockedStateView } from "@/frontend/components/locked-state-view";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import {
  fetchTodayPuzzle,
  submitPuzzle,
  formatDuration,
  PuzzleMovie,
  PuzzleView,
  SubmitResult,
  TodayResponse,
} from "@/frontend/services/cinemind";
import { generateShareGrid } from "@/frontend/utils/generateShareGrid";

type Phase = "loading" | "playing" | "locked" | "results" | "error";

export default function CineMindScreen() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [puzzle, setPuzzle] = useState<PuzzleView | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const [challengeIndex, setChallengeIndex] = useState(0);
  const [connectionAnswer, setConnectionAnswer] = useState<string | null>(null);
  // Ordered ImdbIds the player has tapped so far, oldest-first.
  const [chronosOrder, setChronosOrder] = useState<string[]>([]);
  const [castDeductAnswer, setCastDeductAnswer] = useState<string | null>(null);

  const [elapsedMs, setElapsedMs] = useState(0);
  // Wall-clock start, not an accumulating counter — a throttled JS timer in
  // the background would otherwise under-count the player's real time.
  const startedAt = useRef<number | null>(null);
  const submitting = useRef(false);

  const load = useCallback(async () => {
    setPhase("loading");
    setErrorText(null);
    try {
      const data = await fetchTodayPuzzle();
      setToday(data);
      if (data.isLocked) {
        setPhase("locked");
        return;
      }
      setPuzzle(data.puzzle);
      setChallengeIndex(0);
      setConnectionAnswer(null);
      setChronosOrder([]);
      setCastDeductAnswer(null);
      startedAt.current = Date.now();
      setElapsedMs(0);
      setPhase("playing");
    } catch (err: any) {
      setErrorText(err?.message || "Couldn't load today's puzzle.");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Timer only runs while actually playing.
  useEffect(() => {
    if (phase !== "playing" || startedAt.current == null) return;
    const interval = setInterval(() => {
      if (startedAt.current != null) setElapsedMs(Date.now() - startedAt.current);
    }, 250);
    return () => clearInterval(interval);
  }, [phase]);

  const handleSubmit = async () => {
    // Ref, not state: a double-tap fires both handlers before React re-renders,
    // and the server rejects the second submit as a duplicate — which would
    // surface to the player as a confusing "already played today" error on the
    // very attempt they just made.
    if (submitting.current) return;
    submitting.current = true;

    const timeTakenMs = startedAt.current != null ? Date.now() - startedAt.current : elapsedMs;
    try {
      const graded = await submitPuzzle(
        {
          connectionAnswer,
          chronosOrder: chronosOrder.length > 0 ? chronosOrder : null,
          castDeductAnswer,
        },
        timeTakenMs,
      );
      setResult(graded);
      setPhase("results");
    } catch (err: any) {
      Alert.alert("Couldn't submit", err?.message || "Please try again.");
    } finally {
      submitting.current = false;
    }
  };

  const handleShare = async () => {
    if (!result || !puzzle) return;
    try {
      await Share.share({
        message: generateShareGrid({ puzzleNumber: puzzle.puzzleNumber, result }),
      });
    } catch {
      // Sheet dismissed.
    }
  };

  const toggleChronos = (imdbId: string) => {
    setChronosOrder((prev) =>
      prev.includes(imdbId) ? prev.filter((id) => id !== imdbId) : [...prev, imdbId],
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────

  if (phase === "loading") {
    return (
      <Starfield>
        <ActivityIndicator size="large" color={SpaceTheme.glowCyan} style={{ flex: 1 }} />
      </Starfield>
    );
  }

  if (phase === "error") {
    return (
      <Starfield>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={40} color={SpaceTheme.danger} />
          <Text style={styles.errorText}>{errorText}</Text>
          <TouchableOpacity activeOpacity={0.85} style={styles.primaryButton} onPress={load}>
            <Text style={styles.primaryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </Starfield>
    );
  }

  if (phase === "locked" && today?.isLocked) {
    return (
      <Starfield>
        <ScrollView contentContainerStyle={styles.content}>
          <Header streak={today.streakCount} />
          <LockedStateView
            puzzleNumber={today.puzzleNumber}
            score={today.score}
            maxScore={today.maxScore}
            timeTakenMs={today.timeTakenMs}
            streakCount={today.streakCount}
            secondsUntilNextPuzzle={today.secondsUntilNextPuzzle}
          />
        </ScrollView>
      </Starfield>
    );
  }

  if (phase === "results" && result && puzzle) {
    return (
      <Starfield>
        <ScrollView contentContainerStyle={styles.content}>
          <Header streak={result.streakCount} />
          <Text style={styles.bigTitle}>CineMind #{puzzle.puzzleNumber}</Text>
          <Text style={styles.scoreLine}>
            {result.score}
            <Text style={styles.scoreLineMuted}>/{result.maxScore}</Text>
          </Text>
          <Text style={styles.subtitle}>
            {formatDuration(result.timeTakenMs)} · beat {result.percentileRank}% of players today
          </Text>

          <View style={styles.card}>
            <ResultRow label="The Connection" res={result.connection} />
            <ResultRow label="Chronos" res={result.chronos} />
            <ResultRow label="Cast Deduct" res={result.castDeduct} />
          </View>

          <TouchableOpacity activeOpacity={0.85} style={styles.primaryButton} onPress={handleShare}>
            <Ionicons name="share-outline" size={18} color={SpaceTheme.backgroundVoid} />
            <Text style={styles.primaryButtonText}>Share Result</Text>
          </TouchableOpacity>
        </ScrollView>
      </Starfield>
    );
  }

  if (!puzzle) return null;

  const canAdvance =
    (challengeIndex === 0 && connectionAnswer != null) ||
    (challengeIndex === 1 && chronosOrder.length === puzzle.chronos.movies.length) ||
    (challengeIndex === 2 && castDeductAnswer != null);

  return (
    <Starfield>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Header streak={today && !today.isLocked ? today.streakCount : 0} elapsedMs={elapsedMs} />

        <Text style={styles.puzzleNumber}>CineMind #{puzzle.puzzleNumber}</Text>
        <View style={styles.progressRow}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={[
                styles.progressDot,
                i === challengeIndex && styles.progressDotActive,
                i < challengeIndex && styles.progressDotDone,
              ]}
            />
          ))}
        </View>

        {challengeIndex === 0 && (
          <View style={styles.card}>
            <Text style={styles.challengeLabel}>Challenge 1 of 3</Text>
            <Text style={styles.challengeTitle}>The Connection</Text>
            <Text style={styles.challengeHint}>
              Which {puzzle.connection.linkKind} links all four of these films?
            </Text>
            <PosterRow movies={puzzle.connection.movies} />
            {puzzle.connection.options.map((option) => (
              <Option
                key={option}
                label={option}
                selected={connectionAnswer === option}
                onPress={() => setConnectionAnswer(option)}
              />
            ))}
          </View>
        )}

        {challengeIndex === 1 && (
          <View style={styles.card}>
            <Text style={styles.challengeLabel}>Challenge 2 of 3</Text>
            <Text style={styles.challengeTitle}>Chronos</Text>
            <Text style={styles.challengeHint}>
              Tap these in order of release — oldest first. Tap again to remove.
            </Text>
            {puzzle.chronos.movies.map((movie) => {
              const position = chronosOrder.indexOf(movie.imdbId);
              return (
                <TouchableOpacity
                  key={movie.imdbId}
                  activeOpacity={0.8}
                  style={[styles.orderRow, position >= 0 && styles.orderRowSelected]}
                  onPress={() => toggleChronos(movie.imdbId)}
                >
                  <View style={[styles.orderBadge, position >= 0 && styles.orderBadgeActive]}>
                    <Text
                      style={[styles.orderBadgeText, position >= 0 && styles.orderBadgeTextActive]}
                    >
                      {position >= 0 ? position + 1 : "–"}
                    </Text>
                  </View>
                  <MoviePoster uri={movie.posterPath} width={38} />
                  {/* Release year is deliberately hidden here — showing it
                      would give the answer away. */}
                  <Text style={styles.orderTitle} numberOfLines={2}>
                    {movie.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {challengeIndex === 2 && (
          <View style={styles.card}>
            <Text style={styles.challengeLabel}>Challenge 3 of 3</Text>
            <Text style={styles.challengeTitle}>Cast Deduct</Text>
            <Text style={styles.challengeHint}>Which actor appears in both of these films?</Text>
            <PosterRow movies={[puzzle.castDeduct.movieA, puzzle.castDeduct.movieB]} showTitles />
            {puzzle.castDeduct.options.map((option) => (
              <Option
                key={option}
                label={option}
                selected={castDeductAnswer === option}
                onPress={() => setCastDeductAnswer(option)}
              />
            ))}
          </View>
        )}

        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.primaryButton, !canAdvance && styles.primaryButtonDisabled]}
          disabled={!canAdvance}
          onPress={() => {
            if (challengeIndex < 2) setChallengeIndex(challengeIndex + 1);
            else handleSubmit();
          }}
        >
          <Text style={styles.primaryButtonText}>
            {challengeIndex < 2 ? "Next Challenge" : "Submit & See Score"}
          </Text>
        </TouchableOpacity>

        <Text style={styles.footnote}>One puzzle a day. No takebacks.</Text>
      </ScrollView>
    </Starfield>
  );
}

// ── Small presentational pieces ────────────────────────────────────────────

function Header({ streak, elapsedMs }: { streak: number; elapsedMs?: number }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerPill}>
        <Text style={styles.headerPillText}>🔥 {streak}</Text>
      </View>
      {elapsedMs != null && (
        <View style={styles.headerPill}>
          <Ionicons name="time-outline" size={14} color={SpaceTheme.mutedOrbit} />
          <Text style={styles.headerPillText}>{formatDuration(elapsedMs)}</Text>
        </View>
      )}
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
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
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

function ResultRow({
  label,
  res,
}: {
  label: string;
  res: { correct: boolean; points: number; correctAnswer: string | null };
}) {
  return (
    <View style={styles.resultRow}>
      <Text style={styles.resultMarker}>{res.correct ? "🟩" : "🟥"}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.resultLabel}>{label}</Text>
        {!res.correct && res.correctAnswer && (
          <Text style={styles.resultAnswer}>Answer: {res.correctAnswer}</Text>
        )}
      </View>
      <Text style={styles.resultPoints}>+{res.points}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 20, paddingHorizontal: 16, paddingBottom: 40 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  headerPill: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  headerPillText: { color: SpaceTheme.starWhite, fontSize: 13, fontWeight: "700" },
  puzzleNumber: {
    fontSize: 13,
    color: SpaceTheme.mutedOrbit,
    textTransform: "uppercase",
    fontWeight: "700",
    textAlign: "center",
  },
  progressRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 10, marginBottom: 18 },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  progressDotActive: { backgroundColor: SpaceTheme.glowCyan, width: 22 },
  progressDotDone: { backgroundColor: SpaceTheme.supernovaPink },
  card: { ...SpaceStyles.glassCard, padding: 16, marginBottom: 16 },
  challengeLabel: {
    fontSize: 11,
    color: SpaceTheme.mutedOrbit,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  challengeTitle: { fontSize: 20, fontWeight: "700", color: SpaceTheme.starWhite, marginTop: 2 },
  challengeHint: { fontSize: 13, color: SpaceTheme.mutedOrbit, marginTop: 4, marginBottom: 14, lineHeight: 18 },
  posterRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16, justifyContent: "center" },
  posterCell: { alignItems: "center", width: 72 },
  posterTitle: { fontSize: 10, color: SpaceTheme.mutedOrbit, textAlign: "center", marginTop: 4 },
  option: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    marginBottom: 8,
  },
  optionSelected: { borderColor: SpaceTheme.glowCyan, backgroundColor: "rgba(56,189,248,0.12)" },
  optionText: { flex: 1, color: SpaceTheme.starWhite, fontSize: 15 },
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
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  orderBadgeActive: { backgroundColor: SpaceTheme.glowCyan },
  orderBadgeText: { color: SpaceTheme.mutedOrbit, fontSize: 12, fontWeight: "700" },
  orderBadgeTextActive: { color: SpaceTheme.backgroundVoid },
  orderTitle: { flex: 1, color: SpaceTheme.starWhite, fontSize: 14 },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: SpaceTheme.glowCyan,
    borderRadius: 12,
    paddingVertical: 15,
  },
  primaryButtonDisabled: { backgroundColor: "rgba(255,255,255,0.14)" },
  primaryButtonText: { color: SpaceTheme.backgroundVoid, fontSize: 16, fontWeight: "700" },
  footnote: { textAlign: "center", color: SpaceTheme.mutedOrbit, fontSize: 11, marginTop: 14 },
  bigTitle: { fontSize: 15, color: SpaceTheme.mutedOrbit, textAlign: "center", fontWeight: "700" },
  scoreLine: {
    fontSize: 46,
    fontWeight: "800",
    color: SpaceTheme.starWhite,
    textAlign: "center",
    marginTop: 4,
  },
  scoreLineMuted: { fontSize: 22, color: SpaceTheme.mutedOrbit },
  subtitle: { fontSize: 13, color: SpaceTheme.mutedOrbit, textAlign: "center", marginBottom: 20 },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  resultMarker: { fontSize: 18 },
  resultLabel: { color: SpaceTheme.starWhite, fontSize: 15, fontWeight: "600" },
  resultAnswer: { color: SpaceTheme.mutedOrbit, fontSize: 12, marginTop: 2 },
  resultPoints: { color: SpaceTheme.glowCyan, fontSize: 14, fontWeight: "700" },
  errorText: { color: SpaceTheme.starWhite, fontSize: 15, textAlign: "center" },
});
