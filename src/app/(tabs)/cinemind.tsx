import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Share,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Text } from "@/frontend/components/scaled-text";
import { track } from "@/frontend/services/analytics";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Starfield } from "@/frontend/components/starfield";
import { MoviePoster } from "@/frontend/components/movie-poster";
import { LockedStateView } from "@/frontend/components/locked-state-view";
import { CoachTip } from "@/frontend/components/coach-tip";
import { ResultDot } from "@/frontend/components/result-dot";
import { CineMindStatsCard } from "@/frontend/components/cinemind-stats";
import { GlobalLeaderboardView } from "@/frontend/components/cinemind-global-leaderboard";
import { SpaceTheme, SpaceStyles, Palette, Type, Radius } from "@/frontend/constants/theme";
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
import { useToast } from "@/frontend/components/toast";

type Phase = "loading" | "playing" | "locked" | "results" | "error";

export default function CineMindScreen() {
  const { showToast } = useToast();
  // Global leaderboard used to be its own tab/route (/leaderboard) — now a
  // mode within this tab, switched via LeaderboardLink, so it works whether
  // today's puzzle is loading, locked, in progress, or already submitted.
  const [viewMode, setViewMode] = useState<"puzzle" | "leaderboard">("puzzle");
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

  const [elapsedMs, setElapsedMs] = useState(0);
  // Wall-clock start, not an accumulating counter — a throttled JS timer in
  // the background would otherwise under-count the player's real time.
  const startedAt = useRef<number | null>(null);
  const submitting = useRef(false);
  const [submittingUi, setSubmittingUi] = useState(false);

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
  // The mystery slot can be a film OR a TV show now — the option pool has
  // to come from the catalog the answer actually lives in.
  const mysteryMediaType = puzzle?.mysteryMovie.mediaType ?? "movie";
  const loadCatalog = useCallback(() => {
    setCatalogLoading(true);
    setCatalogError(null);
    browseCatalog(mysteryMediaType)
      .then(setCatalog)
      .catch((err) => {
        console.warn("Couldn't load catalog for the mystery challenge:", err);
        setCatalogError(err?.message || "Couldn't load the list.");
      })
      .finally(() => setCatalogLoading(false));
  }, [mysteryMediaType]);

  useEffect(() => {
    if (challengeIndex !== 3 || catalog != null || catalogLoading || catalogError) return;
    loadCatalog();
  }, [challengeIndex, catalog, catalogLoading, catalogError, loadCatalog]);

  const handleSubmit = async () => {
    // Ref, not state: a double-tap fires both handlers before React re-renders,
    // and the server rejects the second submit as a duplicate — which would
    // surface to the player as a confusing "already played today" error on the
    // very attempt they just made.
    if (submitting.current) return;
    submitting.current = true;
    // State mirror of the ref, purely for feedback: the ref blocks the
    // double-tap synchronously, but causes no re-render — so on the cold
    // backend the button sat enabled-looking and dead for multi-second
    // submits with nothing telling the player their tap registered.
    setSubmittingUi(true);

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
        },
        timeTakenMs,
      );
      setResult(graded);
      setPhase("results");
      track("puzzle_submitted");
      // After the result is on screen, not before — stats are supplementary
      // and shouldn't delay showing someone their score.
      setStats(await fetchStats());
    } catch (err: any) {
      showToast(err?.message || "Couldn't submit your answers. Please try again.");
    } finally {
      submitting.current = false;
      setSubmittingUi(false);
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

  if (viewMode === "leaderboard") {
    return <GlobalLeaderboardView onBack={() => setViewMode("puzzle")} />;
  }

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
          <LeaderboardLink onPress={() => setViewMode("leaderboard")} />
          <RouletteLink />
        </ScrollView>
      </Starfield>
    );
  }

  if (phase === "results" && result && puzzle) {
    return (
      <Starfield>
        <ScrollView contentContainerStyle={styles.content}>
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
            <ResultRow label="The Mystery" res={result.mysteryMovie} />
          </View>

          <TouchableOpacity activeOpacity={0.85} style={styles.primaryButton} onPress={handleShare}>
            <Ionicons name="share-outline" size={18} color={SpaceTheme.backgroundVoid} />
            <Text style={styles.primaryButtonText}>Share Result</Text>
          </TouchableOpacity>

          {/* The one moment CineMind has full attention is right after a
              score — hand it sideways into the actual product. A line, not
              a nag; no score-matching cleverness (that's a matching engine
              we don't have the density to feed). */}
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.crewBridge}
            onPress={() => {
              track("cinemind_bridge_tap");
              router.push("/match");
            }}
            accessibilityRole="button"
            accessibilityLabel="Find a movie crew"
          >
            <Ionicons name="people-outline" size={17} color={Palette.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.crewBridgeTitle}>Movies are better with people.</Text>
              <Text style={styles.crewBridgeSub}>Pick a real showing near you — get a crew.</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Palette.textFaint} />
          </TouchableOpacity>

          {stats && <CineMindStatsCard stats={stats} />}
          <LeaderboardLink onPress={() => setViewMode("leaderboard")} />
          <RouletteLink />
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
    (challengeIndex === 3 && mysteryResolved);

  return (
    <Starfield>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Header elapsedMs={elapsedMs} />
  
          <Text style={styles.puzzleNumber}>CineMind #{puzzle.puzzleNumber}</Text>
          <CoachTip id="cinemind-intro" icon="bulb-outline">
            Five film challenges, once a day. Fewer guesses means more points — and don&apos;t
            forget to come back tomorrow to keep your streak.
          </CoachTip>
          <View style={styles.progressRow}>
            {[0, 1, 2, 3].map((i) => (
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

          {/* Reachable mid-game so the leaderboard is viewable by everyone, not
              only players who've already finished today (returning here keeps
              your in-progress answers — they live in component state). */}
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.leaderboardPeek}
            onPress={() => setViewMode("leaderboard")}
          >
            <Ionicons name="trophy-outline" size={14} color={SpaceTheme.accentGold} />
            <Text style={styles.leaderboardPeekText}>Today&apos;s leaderboard</Text>
          </TouchableOpacity>

          {challengeIndex === 0 && (
            <View style={styles.card}>
              <Text style={styles.challengeLabel}>Challenge 1 of 4</Text>
              <Text style={styles.lockHint}>Tap carefully — answers lock in as you pick.</Text>
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
                  locked={connectionAnswer !== null}
                  onPress={() => setConnectionAnswer(option)}
                />
              ))}
            </View>
          )}
  
          {challengeIndex === 1 && (
            <View style={styles.card}>
              <Text style={styles.challengeLabel}>Challenge 2 of 4</Text>
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
              <Text style={styles.challengeLabel}>Challenge 3 of 4</Text>
              <Text style={styles.challengeTitle}>Cast Deduct</Text>
              <Text style={styles.challengeHint}>Which actor appears in both of these films?</Text>
              <PosterRow movies={[puzzle.castDeduct.movieA, puzzle.castDeduct.movieB]} showTitles />
              {puzzle.castDeduct.options.map((option) => (
                <Option
                  key={option}
                  label={option}
                  selected={castDeductAnswer === option}
                  locked={castDeductAnswer !== null}
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
              onSkip={() => {
                // No guess and no attempts consumed — grades as 0, same as
                // exhausting attempts. The answer still reveals on submit.
                setMysteryGuess(null);
                setMysteryResolved(true);
              }}
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
  
  
          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.primaryButton, (!canAdvance || submittingUi) && styles.primaryButtonDisabled]}
            disabled={!canAdvance || submittingUi}
            onPress={() => {
              if (challengeIndex < 3) setChallengeIndex(challengeIndex + 1);
              else handleSubmit();
            }}
          >
            {submittingUi ? (
              <ActivityIndicator color={SpaceTheme.backgroundVoid} />
            ) : (
              <Text style={styles.primaryButtonText}>
                {challengeIndex < 3 ? "Next Challenge" : "Submit & See Score"}
              </Text>
            )}
          </TouchableOpacity>

          <Text style={styles.footnote}>One puzzle a day. No takebacks.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Starfield>
  );
}

// ── Small presentational pieces ────────────────────────────────────────────

function Header({ elapsedMs }: { elapsedMs?: number }) {
  if (elapsedMs == null) return null;
  return (
    <View style={styles.header}>
      <View style={styles.headerPill}>
        <Ionicons name="time-outline" size={14} color={SpaceTheme.mutedOrbit} />
        <Text style={styles.headerPillText}>{formatDuration(elapsedMs)}</Text>
      </View>
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

function LeaderboardLink({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity activeOpacity={0.85} style={styles.secondaryButton} onPress={onPress}>
      <Ionicons name="trophy-outline" size={18} color={SpaceTheme.accentGold} />
      <Text style={styles.secondaryButtonText}>See Today&apos;s Leaderboard</Text>
    </TouchableOpacity>
  );
}

// Moved here from Home — Roulette is a one-off practice CineMind challenge
// (never touches the streak/leaderboard, see RouletteController's own
// comment), so it belongs alongside the daily puzzle rather than on the
// watch-party-first Home screen.
function RouletteLink() {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      style={styles.secondaryButton}
      onPress={() => router.push("/roulette")}
    >
      <Ionicons name="shuffle" size={18} color={SpaceTheme.supernovaPink} />
      <Text style={styles.secondaryButtonText}>Practice: Movie Roulette</Text>
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
  locked,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  // Once any option in the challenge is chosen the whole set locks — the
  // player commits to their first pick and can't change it (the un-picked
  // options dim and stop responding).
  locked?: boolean;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={locked}
      style={[styles.option, selected && styles.optionSelected, locked && !selected && styles.optionLocked]}
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
  imdbId: string;
  title: string;
  correct: boolean;
  feedback: string[];
}

const MAX_ATTEMPTS_BY_DIFFICULTY: Record<MysteryDifficulty, number> = {
  // Fewer tries than before, to offset the now-richer opening clues (plot is
  // shown from the start): more information per guess, but fewer guesses.
  easy: 3,
  medium: 2,
  hard: 1,
};

type ClueField = "year" | "decade" | "director" | "genre" | "plot" | "cast" | "poster";

// The order clues are revealed in, per difficulty. Earlier entries appear at
// lower tiers; the ladder is filtered against what the puzzle actually
// carries before any of it is sliced (see cluesForTier).
const CLUE_LADDER: Record<MysteryDifficulty, ClueField[]> = {
  // Plot leads every ladder: year + genre alone left the mystery near-
  // unguessable, so the logline is now an opening clue at all difficulties.
  // Hard still stays minimal beyond that — no director/cast/poster ever.
  hard: ["plot", "decade", "genre"],
  // Deliberately a harder set than Easy at every tier: no poster, no director.
  medium: ["plot", "year", "genre", "cast"],
  easy: ["plot", "year", "genre", "director", "cast", "poster"],
};

// How many clues each tier reveals. These counts are the actual difficulty
// contract. The opening tier now reveals enough to include the plot AND the
// old year/genre, rather than just two clues — the whole point of the change,
// since year + genre alone was too little to guess from.
//
// Each array's length MUST equal that difficulty's MAX_ATTEMPTS_BY_DIFFICULTY:
// one entry per attempt. A shorter array would silently clamp the final
// attempts to the last tier's clue count (so the last guess reveals nothing
// new); a longer one would define tiers no player can ever reach.
const CLUE_COUNT_BY_TIER: Record<MysteryDifficulty, number[]> = {
  // Lengths match MAX_ATTEMPTS_BY_DIFFICULTY (1 / 2 / 3). Hard's single guess
  // reveals its full minimal clue set (plot + decade + genre) at once.
  hard: [3],
  medium: [3, 4],
  easy: [3, 5, 6],
};

if (__DEV__) {
  for (const difficulty of Object.keys(CLUE_COUNT_BY_TIER) as MysteryDifficulty[]) {
    if (CLUE_COUNT_BY_TIER[difficulty].length !== MAX_ATTEMPTS_BY_DIFFICULTY[difficulty]) {
      console.warn(
        `CineMind: ${difficulty} has ${MAX_ATTEMPTS_BY_DIFFICULTY[difficulty]} attempts but ` +
          `${CLUE_COUNT_BY_TIER[difficulty].length} clue tiers — these must match.`,
      );
    }
  }
}

// Which fields are visible at a given tier, per difficulty. Every difficulty
// still tops out at 100 pts (see GradeMysteryItem on the backend) — the
// difference is entirely how much you're shown and how many tries you get,
// never a bigger prize.
//
// `available` is what makes this correct rather than aspirational. The old
// version returned a fixed field list per tier, so any clue the puzzle didn't
// actually carry silently rendered as nothing and *consumed its tier slot*.
// That was worst on Mystery TV, where the backend always sends a null
// director (BuildMysteryTv passes null unconditionally): Easy tier 1 asked
// for ["year", "director"] and the player saw only the year — one clue, while
// the difficulty picker promised "4 tries, full clues". Same happened to any
// film OMDb had no director for. Filtering first means a tier always reveals
// the number of real clues it's supposed to.
function cluesForTier(
  difficulty: MysteryDifficulty,
  tier: number,
  available: Set<ClueField>,
): Set<ClueField> {
  const ladder = CLUE_LADDER[difficulty].filter((field) => available.has(field));
  const counts = CLUE_COUNT_BY_TIER[difficulty];
  const count = counts[Math.min(Math.max(tier, 1), counts.length) - 1];
  return new Set(ladder.slice(0, count));
}

// What this particular puzzle can actually show. Year/decade are always
// derivable from releaseYear; everything else depends on what the catalog
// row had.
function availableClues(clues: MysteryMovieView): Set<ClueField> {
  const available = new Set<ClueField>(["year", "decade"]);
  if (clues.director) available.add("director");
  if (clues.genres.length > 0) available.add("genre");
  if (clues.plot) available.add("plot");
  if (clues.cast.length > 0) available.add("cast");
  if (clues.posterPath) available.add("poster");
  return available;
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
// Matching an option to the clues, shared by the option builder and the tap
// handler. Ids are redacted from the payload, so identity is established the
// way the old typed-search flow did it: director (movies only) + year + cast.
function isMysteryMatch(m: CatalogMovie, clues: MysteryMovieView, isTv: boolean): boolean {
  const directorOk = isTv || (!!m.director && m.director === clues.director);
  return (
    directorOk &&
    m.releaseYear === clues.releaseYear &&
    m.cast.length === clues.cast.length &&
    m.cast.every((actor) => clues.cast.includes(actor))
  );
}

// Deterministic tiny hash — the option set must not reshuffle between
// renders or attempts (and Math.random during render trips the compiler's
// purity rule), so everything derives from the puzzle itself.
function mysteryHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// The mystery challenges are a pick-from-six matching game (typed guessing
// asked testers to spell obscure titles and dead-ended on typos). One right
// answer + five decoys, decoys preferring the same decade and shared cast so
// the year/cast clues don't hand the answer over; slot order is seeded by
// the puzzle so it's stable all day. Null when the catalog doesn't contain
// the answer — the caller falls back to skip, same as a failed catalog load.
function buildMysteryOptions(
  catalog: CatalogMovie[],
  clues: MysteryMovieView,
  isTv: boolean,
): CatalogMovie[] | null {
  const answer = catalog.find((m) => isMysteryMatch(m, clues, isTv));
  if (!answer) return null;
  const seed = clues.cast.join("|") + clues.releaseYear;
  const decade = Math.floor(clues.releaseYear / 10);
  const decoys = catalog
    .filter((m) => m.imdbId !== answer.imdbId)
    .map((m) => ({
      m,
      score:
        (Math.floor(m.releaseYear / 10) === decade ? 2 : 0) +
        (m.cast.some((actor) => clues.cast.includes(actor)) ? 1 : 0),
      h: mysteryHash(m.imdbId + seed),
    }))
    .sort((a, b) => b.score - a.score || a.h - b.h)
    .slice(0, 5)
    .map((x) => x.m);
  const insertAt = mysteryHash(seed) % (decoys.length + 1);
  return [...decoys.slice(0, insertAt), answer, ...decoys.slice(insertAt)];
}

function MysteryChallenge({
  challengeNumber,
  clues,
  catalog,
  catalogLoading,
  catalogError,
  onRetryCatalog,
  onSkip,
  attemptsUsed,
  resolved,
  solvedGuess,
  difficulty,
  onDifficultyChange,
  onGuess,
}: {
  challengeNumber: 4;
  clues: MysteryMovieView;
  catalog: CatalogMovie[] | null;
  catalogLoading: boolean;
  catalogError: string | null;
  onRetryCatalog: () => void;
  // Only offered when the catalog can't be loaded — not a general give-up.
  onSkip: () => void;
  attemptsUsed: number;
  resolved: boolean;
  solvedGuess: string | null;
  difficulty: MysteryDifficulty;
  // undefined for the TV track — no difficulty picker there (Easy only, for now).
  onDifficultyChange: ((difficulty: MysteryDifficulty) => void) | undefined;
  onGuess: (imdbId: string, correct: boolean, newAttemptsUsed: number, maxAttempts: number) => void;
}) {
  const [history, setHistory] = useState<MysteryGuessLogEntry[]>([]);

  const isTv = clues.mediaType === "tv";
  const maxAttempts = MAX_ATTEMPTS_BY_DIFFICULTY[difficulty];
  const tier = Math.min(attemptsUsed + 1, maxAttempts);
  const visibleClues = cluesForTier(difficulty, tier, availableClues(clues));
  const decade = `${Math.floor(clues.releaseYear / 10) * 10}s`;

  const options = useMemo(
    () => (catalog ? buildMysteryOptions(catalog, clues, isTv) : null),
    [catalog, clues, isTv],
  );
  const wrongIds = new Set(history.filter((e) => !e.correct).map((e) => e.imdbId));

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
    const correct = isMysteryMatch(m, clues, isTv);
    setHistory((prev) => [
      ...prev,
      { imdbId: m.imdbId, title: m.title, correct, feedback: correct ? [] : nearMissFeedback(m) },
    ]);
    onGuess(m.imdbId, correct, attemptsUsed + 1, maxAttempts);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.challengeLabel}>Challenge {challengeNumber} of 4</Text>
      {/* No emoji — The Connection / Chronos / Cast Deduct don't carry one,
          and the odd title out read as decoration rather than meaning. */}
      <Text style={styles.challengeTitle}>{isTv ? "Mystery TV Show" : "Mystery Movie"}</Text>
      <Text style={styles.challengeHint}>
        Pick the {isTv ? "show" : "film"} that matches the clues. Fewer guesses, more points.
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

      {/* No per-row emptiness guards or "—" placeholders here: visibleClues
          is already filtered to fields this puzzle actually has, so anything
          in the set is guaranteed to render real content. */}
      <View style={styles.clueList}>
        {visibleClues.has("year") && <ClueRow label="Year" value={String(clues.releaseYear)} />}
        {visibleClues.has("decade") && <ClueRow label="Decade" value={decade} />}
        {visibleClues.has("director") && <ClueRow label="Director" value={clues.director!} />}
        {visibleClues.has("genre") && <ClueRow label="Genre" value={clues.genres.join(", ")} />}
        {visibleClues.has("plot") && <ClueRow label="Plot" value={clues.plot!} />}
        {visibleClues.has("cast") && <ClueRow label="Cast" value={clues.cast.join(", ")} />}
      </View>

      {history.map((entry, i) => (
        <View key={i} style={styles.guessRow}>
          <ResultDot correct={entry.correct} style={styles.guessRowMarker} />
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
        // Retry alone used to be the only way out of here, which meant a
        // catalog request that kept failing left the whole day's puzzle
        // unfinishable: this challenge can't be answered without the list, and
        // the Next/Submit button stays disabled until it resolves. Skipping
        // scores this challenge 0 (the same as running out of attempts without
        // getting it), but it lets the other four count.
        <View style={styles.mysteryErrorBox}>
          <Text style={styles.mysteryErrorText}>{catalogError}</Text>
          <TouchableOpacity activeOpacity={0.85} style={styles.mysteryRetryButton} onPress={onRetryCatalog}>
            <Text style={styles.mysteryRetryButtonText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.85} style={styles.mysterySkipButton} onPress={onSkip}>
            <Text style={styles.mysterySkipButtonText}>Skip this challenge</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {catalogLoading && <ActivityIndicator style={styles.mysteryLoadingIndicator} color={SpaceTheme.glowCyan} />}
          {options && (
            <View style={styles.mysteryOptionList}>
              {options.map((m) => {
                const wrong = wrongIds.has(m.imdbId);
                return (
                  <TouchableOpacity
                    key={m.imdbId}
                    activeOpacity={0.8}
                    disabled={wrong}
                    style={[styles.mysteryOption, wrong && styles.mysteryOptionWrong]}
                    onPress={() => handlePick(m)}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: wrong }}
                  >
                    {/* No year on the label: the Year clue is visible from
                        tier 1 on easy/medium, so printing each option's year
                        would let the answer identify itself. */}
                    <Text style={[styles.mysteryOptionText, wrong && styles.mysteryOptionTextWrong]}>
                      {m.title}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          {!catalogLoading && catalog != null && !options && (
            <>
              {/* Catalog loaded but the answer isn't findable in it — same
                  dead-end as a failed catalog load, so offer the same out. */}
              <Text style={styles.mysteryNoMatchesText}>
                Something&apos;s off with today&apos;s list — skip this one and the rest still count.
              </Text>
              <TouchableOpacity activeOpacity={0.85} style={styles.mysterySkipButton} onPress={onSkip}>
                <Text style={styles.mysterySkipButtonText}>Skip this challenge</Text>
              </TouchableOpacity>
            </>
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
    { key: "easy", emoji: "🟢", label: "Easy", blurb: "3 tries, full clues" },
    { key: "medium", emoji: "🟡", label: "Medium", blurb: "2 tries, fewer clues" },
    { key: "hard", emoji: "🔴", label: "Hard", blurb: "1 try, plot + decade + genre" },
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
      <ResultDot correct={res.correct} style={styles.resultDot} />
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
  // 60, matching every other headerless Starfield tab (Home, Spaces,
  // Explore, Profile) — at 20 the timer pill and title sat under the
  // notch/Dynamic Island.
  content: { paddingTop: 60, paddingHorizontal: 16, paddingBottom: 40 },
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
  headerPillText: { color: SpaceTheme.starWhite, ...Type.small, fontWeight: "700" },
  puzzleNumber: {
    ...Type.small,
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
    backgroundColor: Palette.fillStrong,
  },
  progressDotActive: { backgroundColor: SpaceTheme.glowCyan, width: 22 },
  progressDotDone: { backgroundColor: SpaceTheme.supernovaPink },
  card: { ...SpaceStyles.glassCard, padding: 16, marginBottom: 16 },
  challengeLabel: {
    ...Type.caption,
    color: SpaceTheme.mutedOrbit,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  lockHint: { ...Type.caption, color: Palette.textFaint, fontStyle: "italic", marginTop: 2, marginBottom: 6 },
  challengeTitle: { ...Type.title, fontWeight: "700", color: SpaceTheme.starWhite, marginTop: 2 },
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
  optionLocked: { opacity: 0.4 },
  leaderboardPeek: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 4, marginBottom: 8 },
  leaderboardPeekText: { ...Type.small, color: SpaceTheme.accentGold },
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
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: SpaceTheme.glowCyan,
    borderRadius: Radius.medium,
    paddingVertical: 15,
  },
  primaryButtonDisabled: { backgroundColor: Palette.fillStrong },
  primaryButtonText: { color: SpaceTheme.backgroundVoid, ...Type.body, fontWeight: "700" },
  crewBridge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
    padding: 14,
    borderRadius: Radius.small,
    borderWidth: 1,
    borderColor: Palette.accentBorder,
    backgroundColor: Palette.accentDim,
  },
  crewBridgeTitle: { ...Type.small, fontWeight: "700", color: Palette.text },
  crewBridgeSub: { ...Type.caption, color: Palette.textMuted, marginTop: 1 },
  secondaryButton: {
    ...SpaceStyles.glassCard,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    marginTop: 12,
    borderColor: Palette.accentBorder,
  },
  secondaryButtonText: { color: SpaceTheme.accentGold, ...Type.body, fontWeight: "700" },
  countdownText: {
    textAlign: "center",
    color: SpaceTheme.mutedOrbit,
    ...Type.caption,
    marginTop: 16,
    fontVariant: ["tabular-nums"],
  },
  footnote: { textAlign: "center", color: SpaceTheme.mutedOrbit, ...Type.caption, marginTop: 14 },
  bigTitle: { ...Type.body, color: SpaceTheme.mutedOrbit, textAlign: "center", fontWeight: "700" },
  scoreLine: {
    ...Type.display,
    fontWeight: "800",
    color: SpaceTheme.starWhite,
    textAlign: "center",
    marginTop: 4,
  },
  scoreLineMuted: { ...Type.title, color: SpaceTheme.mutedOrbit },
  subtitle: { ...Type.small, color: SpaceTheme.mutedOrbit, textAlign: "center", marginBottom: 20 },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  // Matches the cinemind-result web page's .dot exactly — same size ratio,
  // same two colours (applied inline by ResultDot), so the in-app board and
  // the page a friend opens from a shared link read as the same design.
  resultDot: { width: 10, height: 10, borderRadius: Radius.pill },
  resultLabel: { color: SpaceTheme.starWhite, ...Type.body, fontWeight: "600" },
  resultAnswer: { color: SpaceTheme.mutedOrbit, ...Type.caption, marginTop: 2 },
  resultPoints: { color: SpaceTheme.glowCyan, ...Type.small, fontWeight: "700" },
  errorText: { color: SpaceTheme.starWhite, ...Type.body, textAlign: "center" },
  slowLoadText: {
    color: SpaceTheme.mutedOrbit,
    ...Type.small,
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
  difficultyPillActive: { borderColor: SpaceTheme.glowCyan, backgroundColor: Palette.accentDim },
  difficultyPillLabel: { color: SpaceTheme.starWhite, ...Type.small, fontWeight: "700" },
  difficultyPillBlurb: {
    color: SpaceTheme.mutedOrbit,
    ...Type.caption,
    textAlign: "center",
    marginTop: 3,
  },
  mysteryPosterWrap: { alignItems: "center", marginBottom: 14 },
  clueList: { marginBottom: 10 },
  clueRow: { flexDirection: "row", marginBottom: 8, gap: 10 },
  clueLabel: {
    width: 62,
    ...Type.caption,
    color: SpaceTheme.mutedOrbit,
    textTransform: "uppercase",
    fontWeight: "700",
    paddingTop: 1,
  },
  clueValue: { flex: 1, color: SpaceTheme.starWhite, ...Type.small, lineHeight: 19 },
  guessRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: Palette.border,
  },
  // flex-start on the row (see guessRow) pins this to the top so it sits
  // beside the title's first line rather than drifting to the vertical
  // center when feedback wraps to two lines — marginTop nudges it down to
  // the title text's optical center instead of its very top edge.
  guessRowMarker: { width: 8, height: 8, borderRadius: Radius.pill, marginTop: 5 },
  guessRowTitle: { color: SpaceTheme.starWhite, ...Type.small, fontWeight: "600" },
  guessRowFeedback: { color: SpaceTheme.mutedOrbit, ...Type.caption, marginTop: 1 },
  mysteryInput: {
    ...SpaceStyles.glassCard,
    color: SpaceTheme.starWhite,
    ...Type.body,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 12,
  },
  mysteryMatchRow: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  mysteryMatchText: { color: SpaceTheme.starWhite, ...Type.small },
  mysteryLoadingIndicator: { marginTop: 12 },
  mysteryOptionList: { gap: 8, marginTop: 4 },
  mysteryOption: {
    backgroundColor: Palette.raised,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.small,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  mysteryOptionWrong: { opacity: 0.45, borderColor: Palette.danger },
  mysteryOptionText: { ...Type.small, color: Palette.text, fontWeight: "600" },
  mysteryOptionTextWrong: { color: Palette.textMuted, textDecorationLine: "line-through" },
  mysteryNoMatchesText: {
    color: SpaceTheme.mutedOrbit,
    ...Type.caption,
    textAlign: "center",
    marginTop: 10,
  },
  mysteryErrorBox: { alignItems: "center", marginTop: 12 },
  mysteryErrorText: {
    color: SpaceTheme.danger,
    ...Type.small,
    textAlign: "center",
    marginBottom: 12,
  },
  mysteryRetryButton: {
    backgroundColor: SpaceTheme.glowCyan,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  mysteryRetryButtonText: { color: SpaceTheme.backgroundVoid, ...Type.small, fontWeight: "700" },
  // Deliberately plainer than the retry button next to it — retrying is the
  // action we want taken; skipping is the escape hatch.
  mysterySkipButton: { paddingVertical: 10, paddingHorizontal: 24 },
  mysterySkipButtonText: {
    color: SpaceTheme.mutedOrbit,
    ...Type.small,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  mysteryAttemptsText: {
    color: SpaceTheme.mutedOrbit,
    ...Type.caption,
    textAlign: "center",
    marginTop: 10,
  },
  mysteryResolvedText: {
    color: SpaceTheme.accentGold,
    ...Type.small,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 12,
  },
});
