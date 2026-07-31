using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Backend.Data;
using Backend.Models;

namespace Backend.Services
{
    public interface IDailyPuzzleService
    {
        Task<(DailyPuzzle Puzzle, DailyPuzzlePayload Payload)?> GetOrCreateTodayAsync(AppDbContext db);
        PuzzleView ToClientView(DailyPuzzle puzzle, DailyPuzzlePayload payload);
        SubmitResult Grade(DailyPuzzlePayload payload, SubmittedAnswers answers, int timeTakenMs);

        // ── Roulette (practice challenges) ──
        Task<PracticeSpin?> BuildPracticeSpinAsync(AppDbContext db, string? genre);
        PracticeSpinView ToPracticeView(PracticeSpin spin);
        ChallengeResult GradePracticeChallenge(string challengeType, object challenge, SubmittedAnswers answer);

        // Exposes the otherwise-private Deserialize — the public share-result
        // page needs to re-grade a PAST day's puzzle (not necessarily today's,
        // which is all GetOrCreateTodayAsync can hand back), so it has to load
        // that day's DailyPuzzle row itself and deserialize its payload here.
        DailyPuzzlePayload? DeserializePayload(string json);
    }

    // Generates and grades the one shared daily puzzle.
    //
    // Determinism comes from seeding an RNG with SHA-256(date + secret salt),
    // so the same date always produces the same puzzle without any manual
    // daily data entry — but a player can't precompute tomorrow's puzzle
    // without the salt. A plain `date.GetHashCode()` seed would be both
    // guessable and (for string hashes) not stable across processes.
    public class DailyPuzzleService : IDailyPuzzleService
    {
        private readonly IConfiguration _configuration;
        private readonly ILogger<DailyPuzzleService> _logger;

        // Puzzle #1. The share grid's number is days-since-epoch + 1, which
        // is how Wordle-style numbering stays consistent for everyone.
        private static readonly DateOnly PuzzleEpoch = new(2026, 1, 1);

        public const int PointsPerChallenge = 100;
        public const int MaxScore = 300;

        // Distractor count for multiple choice (answer + 3 wrong = 4 options).
        private const int WrongOptionCount = 3;

        public DailyPuzzleService(IConfiguration configuration, ILogger<DailyPuzzleService> logger)
        {
            _configuration = configuration;
            _logger = logger;
        }

        public async Task<(DailyPuzzle, DailyPuzzlePayload)?> GetOrCreateTodayAsync(AppDbContext db)
        {
            var today = DateOnly.FromDateTime(DateTime.UtcNow);

            var existing = await db.DailyPuzzles.FirstOrDefaultAsync(p => p.PuzzleDate == today);
            if (existing != null)
            {
                var stored = Deserialize(existing.ChallengePayloadJson);
                if (stored != null) return (existing, stored);

                // Corrupt row — regenerate rather than serving a broken day.
                _logger.LogError("Puzzle payload for {Date} failed to deserialize; regenerating.", today);
                db.DailyPuzzles.Remove(existing);
                await db.SaveChangesAsync();
            }

            var catalog = await LoadCatalogAsync(db);
            var generated = Generate(today, catalog);
            if (generated == null)
            {
                _logger.LogError(
                    "Cannot generate puzzle for {Date}: catalog has {Count} usable films. "
                    + "Seed the catalog via POST /api/game/catalog/seed.", today, catalog.Count);
                return null;
            }

            var row = new DailyPuzzle
            {
                PuzzleDate = today,
                PuzzleNumber = today.DayNumber - PuzzleEpoch.DayNumber + 1,
                ChallengePayloadJson = JsonSerializer.Serialize(generated),
                CreatedAt = DateTime.UtcNow,
            };

            try
            {
                db.DailyPuzzles.Add(row);
                await db.SaveChangesAsync();
                return (row, generated);
            }
            catch (DbUpdateException)
            {
                // Another request created today's puzzle first. Its version is
                // authoritative — two players must never get different
                // puzzles for the same date.
                db.ChangeTracker.Clear();
                var winner = await db.DailyPuzzles.FirstOrDefaultAsync(p => p.PuzzleDate == today);
                if (winner == null) return null;
                var winnerPayload = Deserialize(winner.ChallengePayloadJson);
                return winnerPayload == null ? null : (winner, winnerPayload);
            }
        }

        // ── Generation ─────────────────────────────────────────────────────

        private sealed record CatalogEntry(CineMindMovie Movie, List<string> Cast, List<string> Genres);

        private static async Task<List<CatalogEntry>> LoadCatalogAsync(AppDbContext db)
        {
            var movies = await db.CineMindMovies.OrderBy(m => m.ImdbId).ToListAsync();
            return movies
                .Select(m => new CatalogEntry(m, ParseStringList(m.CastJson), ParseStringList(m.GenresJson)))
                .Where(e => e.Movie.ReleaseYear > 0)
                .ToList();
        }

        private DailyPuzzlePayload? Generate(DateOnly date, List<CatalogEntry> catalog)
        {
            // 4 (Connection) + 4 (Chronos, distinct years, unused) + 2
            // (Cast Deduct, unused) = 10 distinct films minimum.
            if (catalog.Count < 10) return null;

            var rng = SeededRandom(date);

            var connection = BuildConnection(rng, catalog);
            if (connection == null) return null;

            // Exclude films already shown in challenge 1 so the day's three
            // challenges don't visibly repeat the same titles.
            var used = connection.Movies.Select(m => m.ImdbId).ToHashSet();

            var chronos = BuildChronos(rng, catalog, used);
            if (chronos == null) return null;
            foreach (var m in chronos.Movies) used.Add(m.ImdbId);

            var castDeduct = BuildCastDeduct(rng, catalog, used);
            if (castDeduct == null) return null;

            return new DailyPuzzlePayload(connection, chronos, castDeduct);
        }

        // Four films sharing one person. Prefers an actor link (more
        // interesting) and falls back to a director link.
        private ConnectionChallenge? BuildConnection(Random rng, List<CatalogEntry> catalog)
        {
            // person -> films they appear in
            var byActor = new Dictionary<string, List<CatalogEntry>>(StringComparer.OrdinalIgnoreCase);
            foreach (var entry in catalog)
            {
                foreach (var actor in entry.Cast)
                {
                    if (!byActor.TryGetValue(actor, out var list)) byActor[actor] = list = new();
                    list.Add(entry);
                }
            }

            var byDirector = catalog
                .Where(e => !string.IsNullOrWhiteSpace(e.Movie.Director))
                .GroupBy(e => e.Movie.Director!, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);

            // Ordered so candidate selection is deterministic before shuffling.
            var actorCandidates = byActor
                .Where(kv => kv.Value.Count >= 4)
                .OrderBy(kv => kv.Key, StringComparer.Ordinal)
                .ToList();
            var directorCandidates = byDirector
                .Where(kv => kv.Value.Count >= 4)
                .OrderBy(kv => kv.Key, StringComparer.Ordinal)
                .ToList();

            var useActor = actorCandidates.Count > 0;
            var pool = useActor ? actorCandidates : directorCandidates;
            if (pool.Count == 0) return null;

            var picked = pool[rng.Next(pool.Count)];
            var chosen = Shuffle(rng, picked.Value).Take(4).ToList();
            var movies = chosen.Select(ToPuzzleMovie).ToList();

            // Anyone ELSE who also appears in all four is an equally valid
            // answer to "which actor links these?" — offering them as a wrong
            // option marks a correct player incorrect. Not hypothetical: the
            // catalog is deliberately clustered around recurring ensembles
            // (Marvel, LOTR), where four films sharing two cast members is
            // routine.
            var alsoLinksAll = useActor
                ? chosen
                    .Select(e => (IEnumerable<string>)e.Cast)
                    .Aggregate((a, b) => a.Intersect(b, StringComparer.OrdinalIgnoreCase))
                    .ToHashSet(StringComparer.OrdinalIgnoreCase)
                : new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            // Distractors: other real people from the catalog, so a wrong
            // option is never obviously fake.
            var allPeople = (useActor
                    ? byActor.Keys.AsEnumerable()
                    : byDirector.Keys.AsEnumerable())
                .Where(p => !string.Equals(p, picked.Key, StringComparison.OrdinalIgnoreCase)
                    && !alsoLinksAll.Contains(p))
                .OrderBy(p => p, StringComparer.Ordinal)
                .ToList();

            var options = Shuffle(rng, allPeople).Take(WrongOptionCount).Append(picked.Key).ToList();

            return new ConnectionChallenge(
                movies,
                picked.Key,
                useActor ? "actor" : "director",
                Shuffle(rng, options));
        }

        // Four films with DISTINCT years — ties would make ordering ambiguous
        // and a correct answer unmarkable.
        private ChronosChallenge? BuildChronos(Random rng, List<CatalogEntry> catalog, HashSet<string> used)
        {
            var available = catalog
                .Where(e => !used.Contains(e.Movie.ImdbId))
                .GroupBy(e => e.Movie.ReleaseYear)
                .Select(g => g.First())
                .OrderBy(e => e.Movie.ImdbId, StringComparer.Ordinal)
                .ToList();

            if (available.Count < 4) return null;

            var chosen = Shuffle(rng, available).Take(4).ToList();
            var correctOrder = chosen
                .OrderBy(e => e.Movie.ReleaseYear)
                .Select(e => e.Movie.ImdbId)
                .ToList();

            // Presented shuffled; a puzzle already in order isn't a puzzle.
            var presented = Shuffle(rng, chosen).Select(ToPuzzleMovie).ToList();
            if (presented.Select(m => m.ImdbId).SequenceEqual(correctOrder))
            {
                presented.Reverse();
            }

            return new ChronosChallenge(presented, correctOrder);
        }

        // Two films sharing exactly one nameable actor.
        private CastDeductChallenge? BuildCastDeduct(Random rng, List<CatalogEntry> catalog, HashSet<string> used)
        {
            var available = catalog
                .Where(e => !used.Contains(e.Movie.ImdbId) && e.Cast.Count > 0)
                .OrderBy(e => e.Movie.ImdbId, StringComparer.Ordinal)
                .ToList();

            // Deterministic scan over shuffled pairs for a shared actor.
            var shuffled = Shuffle(rng, available);
            for (var i = 0; i < shuffled.Count; i++)
            {
                for (var j = i + 1; j < shuffled.Count; j++)
                {
                    var shared = shuffled[i].Cast
                        .Intersect(shuffled[j].Cast, StringComparer.OrdinalIgnoreCase)
                        .OrderBy(a => a, StringComparer.Ordinal)
                        .ToList();
                    if (shared.Count == 0) continue;

                    var answer = shared[rng.Next(shared.Count)];
                    var distractors = catalog
                        .SelectMany(e => e.Cast)
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .Where(a => !shared.Contains(a, StringComparer.OrdinalIgnoreCase))
                        .OrderBy(a => a, StringComparer.Ordinal)
                        .ToList();

                    var options = Shuffle(rng, distractors).Take(WrongOptionCount).Append(answer).ToList();

                    return new CastDeductChallenge(
                        ToPuzzleMovie(shuffled[i]),
                        ToPuzzleMovie(shuffled[j]),
                        answer,
                        Shuffle(rng, options));
                }
            }

            return null;
        }

        // ── Roulette (practice challenges) ────────────────────────────────────
        //
        // Same shape as the daily generators above, but seeded with
        // Random.Shared (no reason for determinism — a practice spin isn't
        // shared between players) and constrained to always include one
        // specific movie, since the whole point of a spin is "here's a
        // challenge about THIS film."

        public async Task<PracticeSpin?> BuildPracticeSpinAsync(AppDbContext db, string? genre)
        {
            var catalog = await LoadCatalogAsync(db);
            if (catalog.Count < 2) return null;

            var pool = string.IsNullOrWhiteSpace(genre)
                ? catalog
                : catalog.Where(e => e.Genres.Any(g => string.Equals(g, genre, StringComparison.OrdinalIgnoreCase))).ToList();
            if (pool.Count == 0) return null;

            var rng = Random.Shared;
            var target = pool[rng.Next(pool.Count)];

            // Random order so a low-connectivity movie doesn't always fail (or
            // succeed) on the same challenge type every time it's spun.
            var challengeTypes = Shuffle(rng, new[] { "connection", "chronos", "castDeduct" });
            foreach (var type in challengeTypes)
            {
                object? challenge = type switch
                {
                    "connection" => BuildConnectionForMovie(rng, catalog, target),
                    "chronos" => BuildChronosForMovie(rng, catalog, target),
                    "castDeduct" => BuildCastDeductForMovie(rng, catalog, target),
                    _ => null,
                };
                if (challenge != null)
                {
                    var movie = new RouletteMovie(target.Movie.ImdbId, target.Movie.Title, target.Movie.PosterPath);
                    return new PracticeSpin(Guid.NewGuid().ToString("N"), movie, type, challenge);
                }
            }

            // This particular movie doesn't share enough cast/director/year
            // overlap with anything else in the catalog for any challenge type
            // — genuinely possible with a small, curated catalog. The caller
            // spins again rather than treating this as an error.
            return null;
        }

        // Same linking logic as BuildConnection, but the pool of candidate
        // people is restricted to target's own cast/director — anyone who
        // doesn't appear in target's film can't be the answer to a challenge
        // that's supposed to be about target.
        private ConnectionChallenge? BuildConnectionForMovie(Random rng, List<CatalogEntry> catalog, CatalogEntry target)
        {
            var byActor = new Dictionary<string, List<CatalogEntry>>(StringComparer.OrdinalIgnoreCase);
            foreach (var entry in catalog)
                foreach (var actor in entry.Cast)
                {
                    if (!byActor.TryGetValue(actor, out var list)) byActor[actor] = list = new();
                    list.Add(entry);
                }

            var byDirector = catalog
                .Where(e => !string.IsNullOrWhiteSpace(e.Movie.Director))
                .GroupBy(e => e.Movie.Director!, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);

            var actorCandidates = target.Cast
                .Where(a => byActor.TryGetValue(a, out var list) && list.Count >= 4)
                .OrderBy(a => a, StringComparer.Ordinal)
                .ToList();

            var useActor = actorCandidates.Count > 0;
            string? personKey = null;
            List<CatalogEntry>? films = null;

            if (useActor)
            {
                personKey = actorCandidates[rng.Next(actorCandidates.Count)];
                films = byActor[personKey];
            }
            else if (!string.IsNullOrWhiteSpace(target.Movie.Director)
                && byDirector.TryGetValue(target.Movie.Director!, out var directorFilms)
                && directorFilms.Count >= 4)
            {
                personKey = target.Movie.Director;
                films = directorFilms;
            }

            if (personKey == null || films == null) return null;

            // target is guaranteed a member of `films` (that's how personKey
            // was chosen), so pin it in and fill the rest randomly.
            var others = Shuffle(rng, films.Where(e => e.Movie.ImdbId != target.Movie.ImdbId)).Take(3).ToList();
            var chosen = new List<CatalogEntry> { target }.Concat(others).ToList();
            var movies = Shuffle(rng, chosen).Select(ToPuzzleMovie).ToList();

            var alsoLinksAll = useActor
                ? chosen
                    .Select(e => (IEnumerable<string>)e.Cast)
                    .Aggregate((a, b) => a.Intersect(b, StringComparer.OrdinalIgnoreCase))
                    .ToHashSet(StringComparer.OrdinalIgnoreCase)
                : new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            var allPeople = (useActor ? byActor.Keys.AsEnumerable() : byDirector.Keys.AsEnumerable())
                .Where(p => !string.Equals(p, personKey, StringComparison.OrdinalIgnoreCase) && !alsoLinksAll.Contains(p))
                .OrderBy(p => p, StringComparer.Ordinal)
                .ToList();

            var options = Shuffle(rng, allPeople).Take(WrongOptionCount).Append(personKey).ToList();

            return new ConnectionChallenge(movies, personKey, useActor ? "actor" : "director", Shuffle(rng, options));
        }

        private ChronosChallenge? BuildChronosForMovie(Random rng, List<CatalogEntry> catalog, CatalogEntry target)
        {
            var others = catalog
                .Where(e => e.Movie.ImdbId != target.Movie.ImdbId && e.Movie.ReleaseYear != target.Movie.ReleaseYear)
                .GroupBy(e => e.Movie.ReleaseYear)
                .Select(g => g.First())
                .ToList();
            if (others.Count < 3) return null;

            var chosen = new List<CatalogEntry> { target }.Concat(Shuffle(rng, others).Take(3)).ToList();
            var correctOrder = chosen.OrderBy(e => e.Movie.ReleaseYear).Select(e => e.Movie.ImdbId).ToList();

            var presented = Shuffle(rng, chosen).Select(ToPuzzleMovie).ToList();
            if (presented.Select(m => m.ImdbId).SequenceEqual(correctOrder)) presented.Reverse();

            return new ChronosChallenge(presented, correctOrder);
        }

        private CastDeductChallenge? BuildCastDeductForMovie(Random rng, List<CatalogEntry> catalog, CatalogEntry target)
        {
            if (target.Cast.Count == 0) return null;

            var candidates = catalog
                .Where(e => e.Movie.ImdbId != target.Movie.ImdbId
                    && e.Cast.Intersect(target.Cast, StringComparer.OrdinalIgnoreCase).Any())
                .ToList();
            if (candidates.Count == 0) return null;

            var other = candidates[rng.Next(candidates.Count)];
            var shared = target.Cast.Intersect(other.Cast, StringComparer.OrdinalIgnoreCase)
                .OrderBy(a => a, StringComparer.Ordinal)
                .ToList();
            var answer = shared[rng.Next(shared.Count)];

            var distractors = catalog
                .SelectMany(e => e.Cast)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Where(a => !shared.Contains(a, StringComparer.OrdinalIgnoreCase))
                .OrderBy(a => a, StringComparer.Ordinal)
                .ToList();
            var options = Shuffle(rng, distractors).Take(WrongOptionCount).Append(answer).ToList();

            // Order is cosmetic here (unlike the daily puzzle there's no
            // "used" set to break ties on) — target first just reads more
            // naturally as "here's the film you spun, plus one that shares
            // an actor with it."
            return new CastDeductChallenge(ToPuzzleMovie(target), ToPuzzleMovie(other), answer, Shuffle(rng, options));
        }

        public PracticeSpinView ToPracticeView(PracticeSpin spin) => new(
            spin.Movie,
            spin.ChallengeType,
            spin.ChallengeType switch
            {
                "connection" => ToConnectionView((ConnectionChallenge)spin.Challenge),
                "chronos" => ToChronosView((ChronosChallenge)spin.Challenge),
                "castDeduct" => ToCastDeductView((CastDeductChallenge)spin.Challenge),
                _ => throw new ArgumentOutOfRangeException(nameof(spin), spin.ChallengeType, "Unknown challenge type"),
            });

        public ChallengeResult GradePracticeChallenge(string challengeType, object challenge, SubmittedAnswers answer) =>
            challengeType switch
            {
                "connection" => GradeText(answer.ConnectionAnswer, ((ConnectionChallenge)challenge).Answer),
                "castDeduct" => GradeText(answer.CastDeductAnswer, ((CastDeductChallenge)challenge).Answer),
                "chronos" => GradeChronos((ChronosChallenge)challenge, answer.ChronosOrder),
                _ => throw new ArgumentOutOfRangeException(nameof(challengeType), challengeType, "Unknown challenge type"),
            };

        // ── Grading ────────────────────────────────────────────────────────

        public SubmitResult Grade(DailyPuzzlePayload payload, SubmittedAnswers answers, int timeTakenMs)
        {
            var connection = GradeText(answers.ConnectionAnswer, payload.Connection.Answer);
            var castDeduct = GradeText(answers.CastDeductAnswer, payload.CastDeduct.Answer);
            var chronos = GradeChronos(payload.Chronos, answers.ChronosOrder);

            var score = connection.Points + chronos.Points + castDeduct.Points;

            // Streak and percentile are filled in by the controller, which
            // owns the database — the service stays pure so it's testable.
            return new SubmitResult(
                score, MaxScore, timeTakenMs,
                StreakCount: 0, PercentileRank: 0,
                connection, chronos, castDeduct);
        }

        // Case- and whitespace-insensitive, because the player types a name.
        private static ChallengeResult GradeText(string? given, string expected)
        {
            var ok = !string.IsNullOrWhiteSpace(given)
                && string.Equals(given.Trim(), expected.Trim(), StringComparison.OrdinalIgnoreCase);
            return new ChallengeResult(ok, ok ? PointsPerChallenge : 0, ok ? null : expected);
        }

        private static ChallengeResult GradeChronos(ChronosChallenge chronos, List<string>? order)
        {
            var correct = order != null
                && order.Count == chronos.CorrectOrder.Count
                && order.SequenceEqual(chronos.CorrectOrder, StringComparer.OrdinalIgnoreCase);

            return new ChallengeResult(
                correct,
                correct ? PointsPerChallenge : 0,
                correct ? null : string.Join(" → ", OrderedTitles(chronos)));
        }

        private static IEnumerable<string> OrderedTitles(ChronosChallenge chronos) =>
            chronos.CorrectOrder.Select(id =>
                chronos.Movies.FirstOrDefault(m => m.ImdbId == id)?.Title ?? id);

        // ── Client view ────────────────────────────────────────────────────

        public PuzzleView ToClientView(DailyPuzzle puzzle, DailyPuzzlePayload p) => new(
            puzzle.PuzzleNumber,
            puzzle.PuzzleDate.ToString("yyyy-MM-dd"),
            // Answers are omitted here, not merely unused — the payload holds
            // every solution, so returning it whole would ship the answer key.
            // Chronos additionally drops the release year, which IS its answer.
            ToConnectionView(p.Connection),
            ToChronosView(p.Chronos),
            ToCastDeductView(p.CastDeduct));

        private static ConnectionView ToConnectionView(ConnectionChallenge c) =>
            new(c.Movies, c.LinkKind, c.Options);

        private static ChronosView ToChronosView(ChronosChallenge c) =>
            new(c.Movies.Select(m => new ChronosMovie(m.ImdbId, m.Title, m.PosterPath)).ToList());

        private static CastDeductView ToCastDeductView(CastDeductChallenge c) =>
            new(c.MovieA, c.MovieB, c.Options);

        // ── Helpers ────────────────────────────────────────────────────────

        private Random SeededRandom(DateOnly date)
        {
            var salt = _configuration["CineMind:PuzzleSalt"];
            if (string.IsNullOrWhiteSpace(salt))
            {
                // Still deterministic, just guessable. Logged so a missing
                // production secret doesn't pass silently.
                _logger.LogWarning("CineMind:PuzzleSalt is not configured — puzzles are predictable.");
                salt = "cinemind-default-salt";
            }

            var hash = SHA256.HashData(Encoding.UTF8.GetBytes($"{date:yyyy-MM-dd}|{salt}"));
            return new Random(BitConverter.ToInt32(hash, 0));
        }

        // Fisher-Yates against the seeded RNG. Returns a new list so callers
        // can't accidentally mutate the catalog.
        private static List<T> Shuffle<T>(Random rng, IEnumerable<T> source)
        {
            var list = source.ToList();
            for (var i = list.Count - 1; i > 0; i--)
            {
                var j = rng.Next(i + 1);
                (list[i], list[j]) = (list[j], list[i]);
            }
            return list;
        }

        private static PuzzleMovie ToPuzzleMovie(CatalogEntry e) =>
            new(e.Movie.ImdbId, e.Movie.Title, e.Movie.ReleaseYear, e.Movie.PosterPath);

        private static List<string> ParseStringList(string json)
        {
            try
            {
                return JsonSerializer.Deserialize<List<string>>(json) ?? new List<string>();
            }
            catch (JsonException)
            {
                return new List<string>();
            }
        }

        public DailyPuzzlePayload? DeserializePayload(string json) => Deserialize(json);

        private static DailyPuzzlePayload? Deserialize(string json)
        {
            try
            {
                return JsonSerializer.Deserialize<DailyPuzzlePayload>(json);
            }
            catch (JsonException)
            {
                return null;
            }
        }
    }
}
