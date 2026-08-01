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
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { MoviePoster } from "@/frontend/components/movie-poster";
import { LockedStateView } from "@/frontend/components/locked-state-view";
import { CineMindStatsCard } from "@/frontend/components/cinemind-stats";
import { SpaceTheme, SpaceStyles } from "@/frontend/constants/theme";
import {
  fetchTodayPuzzle,
  fetchStats,
  submitPuzzle,
  browseCatalog,
  formatCountdown,
  formatDuration,
  CatalogMovie,
  CineMindStats,
  MysteryDifficulty,
  MysteryMovieView,
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
  const [stats, setStats] = useState<CineMindStats | null>(null);
  // Absolute timestamp, captured when the puzzle loads. The server's
  // "seconds remaining" is only true at that moment — anchoring it later
  // (on the results screen, after a few minutes of play) would overstate
  // the time left by exactly how long the player took.
  const [nextPuzzleAt, setNextPuzzleAt] = useState<number | null>(null);

  const [challengeIndex, setChallengeIndex] = useState(0);
  const [connectionAnswer, setConnectionAnswer] = useState<string | null>(null);
  // Ordered ImdbIds the player has tapped so far, oldest-first.
  const [chronosOrder, setChronosOrder] = useState<string[]>([]);
  const [castDeductAnswer, setCastDeductAnswer] = useState<string | null>(null);

  // Mystery Movie/TV's whole interaction (search, guesses, near-miss
  // feedback, tier reveal) happens client-side against data already sent
  // with the puzzle — see MysteryMovieChallenge's own comment on the backend
  // for why that's safe. Each catalog is fetched once, lazily, only once the
  // player actually reaches that challenge (not on load — a player who never
  // gets there shouldn't pay for a request they don't need).
  const [catalog, setCatalog] = useState<CatalogMovie[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [mysteryGuess, setMysteryGuess] = useState<string | null>(null);
  const [mysteryAttemptsUsed, setMysteryAttemptsUsed] = useState(0);
  const [mysteryResolved, setMysteryResolved] = useState(false);
  // Locked once the first guess is made — see the difficulty picker below.
  const [mysteryDifficulty, setMysteryDifficulty] = useState<MysteryDifficulty>("easy");

  const [tvCatalog, setTvCatalog] = useState<CatalogMovie[] | null>(null);
  const [tvCatalogLoading, setTvCatalogLoading] = useState(false);
  const [tvCatalogError, setTvCatalogError] = useState<string | null>(null);
  const [mysteryTvGuess, setMysteryTvGuess] = useState<string | null>(null);
  const [mysteryTvAttemptsUsed, setMysteryTvAttemptsUsed] = useState(0);
  const [mysteryTvResolved, setMysteryTvResolved] = useState(false);

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
      setNextPuzzleAt(Date.now() + data.secondsUntilNextPuzzle * 1000);
      if (data.isLocked) {
        // Only fetched once there's a history worth summarizing — a player
        // mid-puzzle has no use for it and it'd just be a wasted request.
        setStats(await fetchStats());
        setPhase("locked");
        return;
      }
      setPuzzle(data.puzzle);
      setChallengeIndex(0);
      setConnectionAnswer(null);
      setChronosOrder([]);
      setCastDeductAnswer(null);
      setMysteryGuess(null);
      setMysteryAttemptsUsed(0);
      setMysteryResolved(false);
      setMysteryDifficulty("easy");
      setMysteryTvGuess(null);
      setMysteryTvAttemptsUsed(0);
      setMysteryTvResolved(false);
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

  // Lazy: only once the player actually reaches each Mystery challenge.
  // Failure was previously silent (console.warn only) — the search box would
  // just sit there returning zero results forever with no indication
  // anything was wrong, indistinguishable from "broken." Now it's a visible,
  // retryable error instead.
  const loadCatalog = useCallback(() => {
    setCatalogLoading(true);
    setCatalogError(null);
    browseCatalog("movie")
      .then(setCatalog)
      .catch((err) => {
        console.warn("Couldn't load movie catalog for Mystery Movie:", err);
        setCatalogError(err?.message || "Couldn't load the movie list.");
      })
      .finally(() => setCatalogLoading(false));
  }, []);

  useEffect(() => {
    if (challengeIndex !== 3 || catalog != null || catalogLoading || catalogError) return;
    loadCatalog();
  }, [challengeIndex, catalog, catalogLoading, catalogError, loadCatalog]);

  const loadTvCatalog = useCallback(() => {
    setTvCatalogLoading(true);
    setTvCatalogError(null);
    browseCatalog("tv")
      .then(setTvCatalog)
      .catch((err) => {
        console.warn("Couldn't load TV catalog for Mystery TV:", err);
        setTvCatalogError(err?.message || "Couldn't load the show list.");
      })
      .finally(() => setTvCatalogLoading(false));
  }, []);

  useEffect(() => {
    if (challengeIndex !== 4 || tvCatalog != null || tvCatalogLoading || tvCatalogError) return;
    loadTvCatalog();
  }, [challengeIndex, tvCatalog, tvCatalogLoading, tvCatalogError, loadTvCatalog]);

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
          mysteryMovieGuess: mysteryGuess,
          mysteryMovieAttemptsUsed: mysteryAttemptsUsed,
          mysteryMovieDifficulty: mysteryDifficulty,
          mysteryTvGuess: mysteryTvGuess,
          mysteryTvAttemptsUsed: mysteryTvAttemptsUsed,
        },
        timeTakenMs,
      );
      setResult(graded);
      setPhase("results");
      // After the result is on screen, not before — stats are supplementary
      // and shouldn't delay showing someone their score.
      setStats(await fetchStats());
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
        message: generateShareGrid({ puzzleNumber: puzzle.puzzleNumber, result, shareId: result.shareId }),
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
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={SpaceTheme.glowCyan} />
          <SlowLoadNotice />
        </View>
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
    // Built from the locked response directly, so re-sharing works on a
    // return visit — not just in the moments right after submitting. Unlike
    // the old emoji-grid version, this no longer needs the re-graded
    // per-challenge booleans at all: those render on the linked webpage now,
    // not in the message text.
    const shareText = generateShareGrid({
      puzzleNumber: today.puzzleNumber,
      result: {
        score: today.score,
        maxScore: today.maxScore,
        timeTakenMs: today.timeTakenMs,
        streakCount: today.streakCount,
      },
      shareId: today.shareId,
    });

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
            shareText={shareText}
          />
          {stats && <CineMindStatsCard stats={stats} />}
          <LeaderboardLink />
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
            <ResultRow label="Mystery Movie" res={result.mysteryMovie} />
            <ResultRow label="Mystery TV" res={result.mysteryTv} />
          </View>

          <TouchableOpacity activeOpacity={0.85} style={styles.primaryButton} onPress={handleShare}>
            <Ionicons name="share-outline" size={18} color={SpaceTheme.backgroundVoid} />
            <Text style={styles.primaryButtonText}>Share Result</Text>
          </TouchableOpacity>

          {stats && <CineMindStatsCard stats={stats} />}
          <LeaderboardLink />
          <NextPuzzleCountdown deadline={nextPuzzleAt} />
        </ScrollView>
      </Starfield>
    );
  }

  if (!puzzle) return null;

  const canAdvance =
    (challengeIndex === 0 && connectionAnswer != null) ||
    (challengeIndex === 1 && chronosOrder.length === puzzle.chronos.movies.length) ||
    (challengeIndex === 2 && castDeductAnswer != null) ||
    (challengeIndex === 3 && mysteryResolved) ||
    (challengeIndex === 4 && mysteryTvResolved);

  return (
    <Starfield>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Header streak={today && !today.isLocked ? today.streakCount : 0} elapsedMs={elapsedMs} />
  
          <Text style={styles.puzzleNumber}>CineMind #{puzzle.puzzleNumber}</Text>
          <View style={styles.progressRow}>
            {[0, 1, 2, 3, 4].map((i) => (
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
              <Text style={styles.challengeLabel}>Challenge 1 of 5</Text>
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
              <Text style={styles.challengeLabel}>Challenge 2 of 5</Text>
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
              <Text style={styles.challengeLabel}>Challenge 3 of 5</Text>
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
  
          {challengeIndex === 3 && (
            <MysteryChallenge
              challengeNumber={4}
              clues={puzzle.mysteryMovie}
              catalog={catalog}
              catalogLoading={catalogLoading}
              catalogError={catalogError}
              onRetryCatalog={loadCatalog}
              attemptsUsed={mysteryAttemptsUsed}
              resolved={mysteryResolved}
              solvedGuess={mysteryGuess}
              difficulty={mysteryDifficulty}
              onDifficultyChange={setMysteryDifficulty}
              onGuess={(imdbId, correct, newAttemptsUsed, maxAttempts) => {
                setMysteryAttemptsUsed(newAttemptsUsed);
                if (correct || newAttemptsUsed >= maxAttempts) {
                  setMysteryGuess(correct ? imdbId : null);
                  setMysteryResolved(true);
                }
              }}
            />
          )}
  
          {challengeIndex === 4 && (
            <MysteryChallenge
              challengeNumber={5}
              clues={puzzle.mysteryTv}
              catalog={tvCatalog}
              catalogLoading={tvCatalogLoading}
              catalogError={tvCatalogError}
              onRetryCatalog={loadTvCatalog}
              attemptsUsed={mysteryTvAttemptsUsed}
              resolved={mysteryTvResolved}
              solvedGuess={mysteryTvGuess}
              difficulty="easy"
              onDifficultyChange={undefined}
              onGuess={(imdbId, correct, newAttemptsUsed, maxAttempts) => {
                setMysteryTvAttemptsUsed(newAttemptsUsed);
                if (correct || newAttemptsUsed >= maxAttempts) {
                  setMysteryTvGuess(correct ? imdbId : null);
                  setMysteryTvResolved(true);
                }
              }}
            />
          )}
  
          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.primaryButton, !canAdvance && styles.primaryButtonDisabled]}
            disabled={!canAdvance}
            onPress={() => {
              if (challengeIndex < 4) setChallengeIndex(challengeIndex + 1);
              else handleSubmit();
            }}
          >
            <Text style={styles.primaryButtonText}>
              {challengeIndex < 4 ? "Next Challenge" : "Submit & See Score"}
            </Text>
          </TouchableOpacity>

          <Text style={styles.footnote}>One puzzle a day. No takebacks.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
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

// The backend sleeps when idle and can take ~30s to wake, which is long
// enough that a bare spinner reads as a frozen app. Silent for the first few
// seconds so a normal fast load never shows it.
function SlowLoadNotice() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(timer);
  }, []);

  if (!slow) return null;

  return <Text style={styles.slowLoadText}>Waking up the server — this can take a moment…</Text>;
}

function LeaderboardLink() {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      style={styles.secondaryButton}
      onPress={() => router.push("/leaderboard")}
    >
      <Ionicons name="trophy-outline" size={18} color={SpaceTheme.accentGold} />
      <Text style={styles.secondaryButtonText}>See Today&apos;s Leaderboard</Text>
    </TouchableOpacity>
  );
}

// Live countdown to the next puzzle. Takes an absolute timestamp rather than
// a duration, so the time played between loading and finishing doesn't get
// added back onto the clock. Recomputing from the deadline each tick also
// self-corrects when a throttled interval fires late.
function NextPuzzleCountdown({ deadline }: { deadline: number | null }) {
  const [remaining, setRemaining] = useState(() =>
    deadline == null ? 0 : Math.max(0, Math.round((deadline - Date.now()) / 1000)),
  );

  useEffect(() => {
    if (deadline == null) return;
    const interval = setInterval(() => {
      setRemaining(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  if (deadline == null) return null;

  return <Text style={styles.countdownText}>Next CineMind in {formatCountdown(remaining)}</Text>;
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

interface MysteryGuessLogEntry {
  title: string;
  correct: boolean;
  feedback: string[];
}

const MAX_ATTEMPTS_BY_DIFFICULTY: Record<MysteryDifficulty, number> = {
  easy: 4,
  medium: 3,
  hard: 2,
};

type ClueField = "year" | "decade" | "director" | "genre" | "plot" | "cast" | "poster";

// Which fields are visible at a given tier, per difficulty. Every difficulty
// still tops out at 100 pts (see GradeMysteryItem on the backend) — the
// difference is entirely how much you're shown and how many tries you get,
// never a bigger prize.
function cluesForTier(difficulty: MysteryDifficulty, tier: number): Set<ClueField> {
  if (difficulty === "hard") {
    // 2 attempts: decade + vague plot, then + genre. No director/cast/poster
    // ever — Hard means genuinely minimal information.
    return new Set(tier >= 2 ? ["decade", "plot", "genre"] : ["decade", "plot"]);
  }
  if (difficulty === "medium") {
    // 3 attempts: year + genre, then + cast, then + plot. No poster, no
    // director — a deliberately harder set than Easy at every tier.
    if (tier >= 3) return new Set(["year", "genre", "cast", "plot"]);
    if (tier === 2) return new Set(["year", "genre", "cast"]);
    return new Set(["year", "genre"]);
  }
  // Easy: 4 attempts, the full clue set.
  if (tier >= 4) return new Set(["year", "director", "genre", "plot", "cast", "poster"]);
  if (tier === 3) return new Set(["year", "director", "genre", "plot"]);
  if (tier === 2) return new Set(["year", "director", "genre"]);
  return new Set(["year", "director"]);
}

// Challenges 4 & 5 (movie and TV). Unlike the other three, this is a live
// multi-attempt loop rather than a single pick — search, guess, get
// near-miss feedback, repeat. Everything here runs against `clues` (already
// fully sent with the puzzle) and `catalog` (fetched once) — no network call
// per guess. See MysteryMovieChallenge's comment in CineMindContracts.cs for
// why that's safe: only the target's own identity is secret, and correctness
// here is determined by an exact match on year + full cast (+ director, for
// movies) against a small hand-curated catalog, which is reliable enough in
// practice without ever needing the server to confirm a specific guess.
function MysteryChallenge({
  challengeNumber,
  clues,
  catalog,
  catalogLoading,
  catalogError,
  onRetryCatalog,
  attemptsUsed,
  resolved,
  solvedGuess,
  difficulty,
  onDifficultyChange,
  onGuess,
}: {
  challengeNumber: 4 | 5;
  clues: MysteryMovieView;
  catalog: CatalogMovie[] | null;
  catalogLoading: boolean;
  catalogError: string | null;
  onRetryCatalog: () => void;
  attemptsUsed: number;
  resolved: boolean;
  solvedGuess: string | null;
  difficulty: MysteryDifficulty;
  // undefined for the TV track — no difficulty picker there (Easy only, for now).
  onDifficultyChange: ((difficulty: MysteryDifficulty) => void) | undefined;
  onGuess: (imdbId: string, correct: boolean, newAttemptsUsed: number, maxAttempts: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [history, setHistory] = useState<MysteryGuessLogEntry[]>([]);

  const isTv = clues.mediaType === "tv";
  const maxAttempts = MAX_ATTEMPTS_BY_DIFFICULTY[difficulty];
  const tier = Math.min(attemptsUsed + 1, maxAttempts);
  const visibleClues = cluesForTier(difficulty, tier);
  const decade = `${Math.floor(clues.releaseYear / 10) * 10}s`;

  const query = search.trim().toLowerCase();
  const matches =
    catalog && query.length > 0
      ? catalog.filter((m) => m.title.toLowerCase().includes(query)).slice(0, 6)
      : [];

  // Director only factors in for movies — clues.director (and every catalog
  // TV entry's director) is always null for the TV track, so comparing it
  // there would be vacuously true and wouldn't help discriminate anything.
  const isMatch = (m: CatalogMovie) => {
    const directorOk = isTv || (!!m.director && m.director === clues.director);
    return (
      directorOk &&
      m.releaseYear === clues.releaseYear &&
      m.cast.length === clues.cast.length &&
      m.cast.every((actor) => clues.cast.includes(actor))
    );
  };

  const nearMissFeedback = (m: CatalogMovie): string[] => {
    const feedback: string[] = [];
    if (!isTv && clues.director && m.director === clues.director) feedback.push("🎬 Same director");
    if (m.cast.some((actor) => clues.cast.includes(actor))) feedback.push("🎭 Shares cast");
    if (m.releaseYear !== clues.releaseYear && Math.abs(m.releaseYear - clues.releaseYear) <= 2) {
      feedback.push("📅 Close year");
    }
    return feedback.length > 0 ? feedback : ["❄️ Cold — no strong connection"];
  };

  const handlePick = (m: CatalogMovie) => {
    if (resolved) return;
    const correct = isMatch(m);
    setHistory((prev) => [...prev, { title: m.title, correct, feedback: correct ? [] : nearMissFeedback(m) }]);
    setSearch("");
    onGuess(m.imdbId, correct, attemptsUsed + 1, maxAttempts);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.challengeLabel}>Challenge {challengeNumber} of 5</Text>
      <Text style={styles.challengeTitle}>{isTv ? "📺 Mystery TV Show" : "🎬 Mystery Movie"}</Text>
      <Text style={styles.challengeHint}>
        Guess the {isTv ? "show" : "film"} from the clues below. Fewer guesses, more points.
      </Text>

      {onDifficultyChange && (
        <DifficultySelector
          selected={difficulty}
          locked={attemptsUsed > 0}
          onSelect={onDifficultyChange}
        />
      )}

      {visibleClues.has("poster") && clues.posterPath && (
        <View style={styles.mysteryPosterWrap}>
          <MoviePoster uri={clues.posterPath} width={100} />
        </View>
      )}

      <View style={styles.clueList}>
        {visibleClues.has("year") && <ClueRow label="Year" value={String(clues.releaseYear)} />}
        {visibleClues.has("decade") && <ClueRow label="Decade" value={decade} />}
        {visibleClues.has("director") && !!clues.director && (
          <ClueRow label="Director" value={clues.director} />
        )}
        {visibleClues.has("genre") && <ClueRow label="Genre" value={clues.genres.join(", ") || "—"} />}
        {visibleClues.has("plot") && !!clues.plot && <ClueRow label="Plot" value={clues.plot} />}
        {visibleClues.has("cast") && <ClueRow label="Cast" value={clues.cast.join(", ") || "—"} />}
      </View>

      {history.map((entry, i) => (
        <View key={i} style={styles.guessRow}>
          <Text style={styles.guessRowMarker}>{entry.correct ? "🟩" : "🟥"}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.guessRowTitle}>{entry.title}</Text>
            {!entry.correct && (
              <Text style={styles.guessRowFeedback}>{entry.feedback.join(" · ")}</Text>
            )}
          </View>
        </View>
      ))}

      {resolved ? (
        <Text style={styles.mysteryResolvedText}>
          {solvedGuess ? "🏆 Solved!" : "Out of attempts — the answer reveals when you submit."}
        </Text>
      ) : catalogError ? (
        <View style={styles.mysteryErrorBox}>
          <Text style={styles.mysteryErrorText}>{catalogError}</Text>
          <TouchableOpacity activeOpacity={0.85} style={styles.mysteryRetryButton} onPress={onRetryCatalog}>
            <Text style={styles.mysteryRetryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <TextInput
            style={styles.mysteryInput}
            value={search}
            onChangeText={setSearch}
            placeholder={catalogLoading ? "Loading list…" : `Type a ${isTv ? "show" : "movie"} title…`}
            placeholderTextColor={SpaceTheme.mutedOrbit}
            editable={!catalogLoading}
            autoCorrect={false}
          />
          {catalogLoading && <ActivityIndicator style={styles.mysteryLoadingIndicator} color={SpaceTheme.glowCyan} />}
          {matches.map((m) => (
            <TouchableOpacity
              key={m.imdbId}
              activeOpacity={0.8}
              style={styles.mysteryMatchRow}
              onPress={() => handlePick(m)}
            >
              <Text style={styles.mysteryMatchText}>
                {m.title} ({m.releaseYear})
              </Text>
            </TouchableOpacity>
          ))}
          {!catalogLoading && catalog != null && query.length > 0 && matches.length === 0 && (
            <Text style={styles.mysteryNoMatchesText}>No matches — check the spelling?</Text>
          )}
          <Text style={styles.mysteryAttemptsText}>
            Attempt {attemptsUsed + 1} of {maxAttempts}
          </Text>
        </>
      )}
    </View>
  );
}

function DifficultySelector({
  selected,
  locked,
  onSelect,
}: {
  selected: MysteryDifficulty;
  locked: boolean;
  onSelect: (difficulty: MysteryDifficulty) => void;
}) {
  const options: { key: MysteryDifficulty; emoji: string; label: string; blurb: string }[] = [
    { key: "easy", emoji: "🟢", label: "Easy", blurb: "4 tries, full clues" },
    { key: "medium", emoji: "🟡", label: "Medium", blurb: "3 tries, fewer clues" },
    { key: "hard", emoji: "🔴", label: "Hard", blurb: "2 tries, decade + plot only" },
  ];

  return (
    <View style={styles.difficultyRow}>
      {options.map((opt) => {
        const active = selected === opt.key;
        // Once locked, only the chosen tier stays visible/enabled — the rest
        // are just hidden rather than shown-disabled, so the row doesn't
        // read as "you could still switch" once a guess has been made.
        if (locked && !active) return null;
        return (
          <TouchableOpacity
            key={opt.key}
            activeOpacity={0.8}
            disabled={locked}
            style={[styles.difficultyPill, active && styles.difficultyPillActive]}
            onPress={() => onSelect(opt.key)}
          >
            <Text style={styles.difficultyPillLabel}>
              {opt.emoji} {opt.label}
            </Text>
            <Text style={styles.difficultyPillBlurb}>{opt.blurb}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function ClueRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.clueRow}>
      <Text style={styles.clueLabel}>{label}</Text>
      <Text style={styles.clueValue}>{value}</Text>
    </View>
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
  flex: { flex: 1 },
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
  secondaryButton: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    marginTop: 12,
    borderColor: "rgba(245, 197, 24, 0.4)",
  },
  secondaryButtonText: { color: SpaceTheme.accentGold, fontSize: 15, fontWeight: "700" },
  countdownText: {
    textAlign: "center",
    color: SpaceTheme.mutedOrbit,
    fontSize: 12,
    marginTop: 16,
    fontVariant: ["tabular-nums"],
  },
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
  slowLoadText: {
    color: SpaceTheme.mutedOrbit,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  difficultyRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  difficultyPill: {
    ...SpaceStyles.glassCard,
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  difficultyPillActive: { borderColor: SpaceTheme.glowCyan, backgroundColor: "rgba(56,189,248,0.14)" },
  difficultyPillLabel: { color: SpaceTheme.starWhite, fontSize: 13, fontWeight: "700" },
  difficultyPillBlurb: {
    color: SpaceTheme.mutedOrbit,
    fontSize: 10,
    textAlign: "center",
    marginTop: 3,
  },
  mysteryPosterWrap: { alignItems: "center", marginBottom: 14 },
  clueList: { marginBottom: 10 },
  clueRow: { flexDirection: "row", marginBottom: 8, gap: 10 },
  clueLabel: {
    width: 62,
    fontSize: 11,
    color: SpaceTheme.mutedOrbit,
    textTransform: "uppercase",
    fontWeight: "700",
    paddingTop: 1,
  },
  clueValue: { flex: 1, color: SpaceTheme.starWhite, fontSize: 14, lineHeight: 19 },
  guessRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  guessRowMarker: { fontSize: 14, marginTop: 1 },
  guessRowTitle: { color: SpaceTheme.starWhite, fontSize: 13, fontWeight: "600" },
  guessRowFeedback: { color: SpaceTheme.mutedOrbit, fontSize: 12, marginTop: 1 },
  mysteryInput: {
    ...SpaceStyles.glassCard,
    color: SpaceTheme.starWhite,
    fontSize: 15,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 12,
  },
  mysteryMatchRow: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  mysteryMatchText: { color: SpaceTheme.starWhite, fontSize: 14 },
  mysteryLoadingIndicator: { marginTop: 12 },
  mysteryNoMatchesText: {
    color: SpaceTheme.mutedOrbit,
    fontSize: 12,
    textAlign: "center",
    marginTop: 10,
  },
  mysteryErrorBox: { alignItems: "center", marginTop: 12 },
  mysteryErrorText: {
    color: SpaceTheme.danger,
    fontSize: 13,
    textAlign: "center",
    marginBottom: 12,
  },
  mysteryRetryButton: {
    backgroundColor: SpaceTheme.glowCyan,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  mysteryRetryButtonText: { color: SpaceTheme.backgroundVoid, fontSize: 13, fontWeight: "700" },
  mysteryAttemptsText: {
    color: SpaceTheme.mutedOrbit,
    fontSize: 11,
    textAlign: "center",
    marginTop: 10,
  },
  mysteryResolvedText: {
    color: SpaceTheme.accentGold,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 12,
  },
});
