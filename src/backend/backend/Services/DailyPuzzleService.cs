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
        Task<PracticeSpin?> BuildPracticeSpinAsync(AppDbContext db, string? genre, string userId);
        Task RecordSpinAsync(AppDbContext db, string userId, PracticeSpin spin);
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
        // 5 challenges now — Connection + Chronos + CastDeduct + Mystery
        // Movie + Mystery TV, each worth 100 at best regardless of
        // difficulty (see GradeMysteryItem — harder difficulty means fewer
        // attempts/clues, never a bigger prize, specifically so this stays a
        // fixed number the leaderboard/percentile/stats can keep assuming).
        // 4 scored challenges × 100. Mystery TV (challenge 5) was cut
        // 2026-09-03 — after the matching-game conversion it played as a
        // duplicate of Mystery Movie. It's still GENERATED (payload schema
        // unchanged, old rows readable) and still GRADED at zero points, so
        // the previous TestFlight build can keep submitting it safely.
        public const int MaxScore = 400;

        // The five-challenge era: rows written on or before this puzzle date
        // were scored out of 500 with Mystery TV counted. Stats, perfect-day
        // checks, and the share page must judge a row against ITS era's
        // ceiling — comparing a 500-scale row to MaxScore=400 misclassifies
        // every historic day in both directions.
        public const int LegacyMaxScore = 500;
        public static readonly DateOnly FiveChallengeEraEnd = new(2026, 9, 3);
        public static int MaxScoreFor(DateOnly puzzleDate) =>
            puzzleDate <= FiveChallengeEraEnd ? LegacyMaxScore : MaxScore;

        // Distractor count for multiple choice (answer + 3 wrong = 4 options).
        private const int WrongOptionCount = 3;

        // How far back "don't show me this again" reaches, for both games.
        // Seven days for Roulette (per-user spin history) and the six prior
        // puzzles for the daily game — the same week-long promise from the
        // player's side, expressed in whichever unit each game counts in.
        private static readonly TimeSpan RecentSpinWindow = TimeSpan.FromDays(7);
        private const int RecentPuzzleDays = 6;

        // Hard ceiling on retained spin rows per user, independent of the age
        // window above. The age prune alone is not a bound: /api/roulette/spin
        // only carries the global 300-req/min limit, so a user hammering it
        // could bank ~3M rows inside one window — and since each spin reads
        // that user's whole window back, they'd be amplifying their own reads
        // with every request.
        //
        // 200 is comfortably above what the feature can use: the exclusion
        // only cares about distinct films, and the largest possible pool is
        // the whole catalog (~137). Anything past that is already redundant.
        private const int MaxTrackedSpinsPerUser = 200;

        public DailyPuzzleService(IConfiguration configuration, ILogger<DailyPuzzleService> logger)
        {
            _configuration = configuration;
            _logger = logger;
        }

        public async Task<(DailyPuzzle, DailyPuzzlePayload)?> GetOrCreateTodayAsync(AppDbContext db)
        {
            var today = CentralTime.Today;

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
            var tvCatalog = await LoadTvCatalogAsync(db);

            // Keep a week of puzzles from recycling the same titles. Each day
            // consumes 11 films, so over seven days a 137-film catalog would
            // otherwise be expected to show ~16 repeat sightings, with a ~60%
            // chance any given day reuses at least one film from the day
            // before — noticeable in a game whose whole format is "look at
            // these four films".
            //
            // Filtering the catalog rather than threading an exclusion set
            // through all five builders keeps Generate itself unchanged, which
            // is what lets the retry loop below vary the window by simply
            // handing it a different list.
            var recentPuzzles = await db.DailyPuzzles
                .Where(p => p.PuzzleDate < today && p.PuzzleDate >= today.AddDays(-RecentPuzzleDays))
                .ToListAsync();

            // Narrow the window progressively instead of dropping it wholesale
            // on the first failure. Six days removes ~66 of ~137 films, which
            // can break up the actor clusters BuildConnection depends on (it
            // needs four films sharing one person) — and an all-or-nothing
            // fallback would answer that by reverting to *no* exclusion at
            // all, silently making this feature do nothing on exactly the days
            // it's hardest. Stepping 6 → 3 → 1 → 0 keeps whatever freshness is
            // actually achievable, and the final 0 still guarantees a puzzle.
            //
            // Every attempt re-seeds from the same date, so the day remains
            // deterministic and identical for every player regardless of which
            // step succeeds.
            DailyPuzzlePayload? generated = null;
            foreach (var windowDays in new[] { RecentPuzzleDays, 3, 1, 0 })
            {
                var window = recentPuzzles.Where(p => p.PuzzleDate >= today.AddDays(-windowDays)).ToList();
                var (recentMovies, recentTv) = RecentlyUsedIds(window);

                var freshCatalog = catalog.Where(e => !recentMovies.Contains(e.Movie.ImdbId)).ToList();
                var freshTvCatalog = tvCatalog.Where(e => !recentTv.Contains(e.Show.ImdbId)).ToList();

                generated = Generate(today, freshCatalog, freshTvCatalog);
                if (generated != null)
                {
                    if (windowDays < RecentPuzzleDays)
                    {
                        _logger.LogInformation(
                            "Puzzle for {Date} fell back to a {Days}-day no-repeat window; the catalog "
                            + "is too thin to avoid {Full} days of repeats.", today, windowDays, RecentPuzzleDays);
                    }
                    break;
                }
            }

            if (generated == null)
            {
                _logger.LogError(
                    "Cannot generate puzzle for {Date}: catalog has {MovieCount} usable films, "
                    + "{TvCount} usable shows. Seed via POST /api/game/catalog/seed and "
                    + "POST /api/game/catalog/seed-tv.", today, catalog.Count, tvCatalog.Count);
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
        private sealed record TvCatalogEntry(CineMindTvShow Show, List<string> Cast, List<string> Genres);

        private static async Task<List<CatalogEntry>> LoadCatalogAsync(AppDbContext db)
        {
            var movies = await db.CineMindMovies.OrderBy(m => m.ImdbId).ToListAsync();
            return movies
                .Select(m => new CatalogEntry(m, ParseStringList(m.CastJson), ParseStringList(m.GenresJson)))
                .Where(e => e.Movie.ReleaseYear > 0)
                .ToList();
        }

        private static async Task<List<TvCatalogEntry>> LoadTvCatalogAsync(AppDbContext db)
        {
            var shows = await db.CineMindTvShows.OrderBy(m => m.ImdbId).ToListAsync();
            return shows
                .Select(m => new TvCatalogEntry(m, ParseStringList(m.CastJson), ParseStringList(m.GenresJson)))
                .Where(e => e.Show.ReleaseYear > 0)
                .ToList();
        }

        private DailyPuzzlePayload? Generate(DateOnly date, List<CatalogEntry> catalog, List<TvCatalogEntry> tvCatalog)
        {
            // 4 (Connection) + 4 (Chronos, distinct years, unused) + 2
            // (Cast Deduct, unused) + 1 (Mystery Movie, unused) = 11 distinct
            // films minimum, plus 1 distinct show in the separate TV catalog.
            if (catalog.Count < 11 || tvCatalog.Count < 1) return null;

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
            used.Add(castDeduct.MovieA.ImdbId);
            used.Add(castDeduct.MovieB.ImdbId);

            // The mystery slot draws from BOTH catalogs — roughly one day
            // in three is a TV show. Same seeded rng, so the day's puzzle
            // stays deterministic; falls back to a film when the TV catalog
            // is empty. (The legacy MysteryTv slot below still exists for
            // old clients; it's unscored either way.)
            // GATED OFF until the post-2026-09 client build is broadly
            // installed: shipped builds hardcode the MOVIE catalog for the
            // mystery autocomplete, so a TV answer is unwinnable for them
            // (silently degrades to skip = guaranteed 0). Flip the Render env
            // var CineMind__TvMysteryEnabled=true once the new build is out.
            // rng.Next(3) is consumed regardless so the day's stream (and
            // therefore every other challenge) is identical either way.
            var tvMysteryEnabled = string.Equals(
                _configuration["CineMind:TvMysteryEnabled"], "true", StringComparison.OrdinalIgnoreCase);
            var wantTvMystery = rng.Next(3) == 0;
            var mysteryMovie = tvMysteryEnabled && wantTvMystery
                ? BuildMysteryTv(rng, tvCatalog) ?? BuildMysteryMovie(rng, catalog, used)
                : BuildMysteryMovie(rng, catalog, used);
            if (mysteryMovie == null) return null;

            // Legacy slot for old clients (unscored). Must not duplicate the
            // scored mystery when THAT is a TV show today.
            var mysteryTv = BuildMysteryTv(rng, tvCatalog,
                exclude: mysteryMovie.MediaType == "tv" ? mysteryMovie.Answer : null);
            if (mysteryTv == null) return null;

            // Stamped explicitly, not defaulted — see DailyPuzzlePayload's
            // comment on why the record's default has to be the untagged
            // sentinel. This is the only place a payload that will be
            // persisted is built, so it's the only place that needs to say so.
            return new DailyPuzzlePayload(
                connection, chronos, castDeduct, mysteryMovie, mysteryTv,
                DailyPuzzlePayload.CurrentSchemaVersion);
        }

        // Picks one unused film as the hidden target — no distractor logic
        // needed, unlike the other three challenges: the "options" here are
        // effectively the whole catalog, narrowed by clues rather than a
        // fixed multiple-choice list.
        private static MysteryMovieChallenge? BuildMysteryMovie(Random rng, List<CatalogEntry> catalog, HashSet<string> used)
        {
            var available = catalog.Where(e => !used.Contains(e.Movie.ImdbId)).ToList();
            if (available.Count == 0) return null;

            var target = available[rng.Next(available.Count)];
            return new MysteryMovieChallenge(
                "movie",
                target.Movie.ImdbId,
                target.Movie.Title,
                target.Movie.Director,
                target.Cast,
                target.Genres,
                target.Movie.ReleaseYear,
                target.Movie.Plot,
                target.Movie.PosterPath);
        }

        // Same shape, TV catalog — no Director (see CineMindTvShow) and no
        // "used" exclusion since this pool is entirely separate from the
        // movie challenges' catalog.
        private static MysteryMovieChallenge? BuildMysteryTv(
            Random rng, List<TvCatalogEntry> tvCatalog, string? exclude = null)
        {
            var pool = exclude == null
                ? tvCatalog
                : tvCatalog.Where(e => !string.Equals(e.Show.ImdbId, exclude, StringComparison.OrdinalIgnoreCase)).ToList();
            if (pool.Count == 0) return null;

            var target = pool[rng.Next(pool.Count)];
            return new MysteryMovieChallenge(
                "tv",
                target.Show.ImdbId,
                target.Show.Title,
                null,
                target.Cast,
                target.Genres,
                target.Show.ReleaseYear,
                target.Show.Plot,
                target.Show.PosterPath);
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

        public async Task<PracticeSpin?> BuildPracticeSpinAsync(AppDbContext db, string? genre, string userId)
        {
            var catalog = await LoadCatalogAsync(db);
            if (catalog.Count < 2) return null;

            var pool = string.IsNullOrWhiteSpace(genre)
                ? catalog
                : catalog.Where(e => e.Genres.Any(g => string.Equals(g, genre, StringComparison.OrdinalIgnoreCase))).ToList();
            if (pool.Count == 0) return null;

            var rng = Random.Shared;

            // Most recent sighting per film, for this user, inside the window.
            // Films they haven't seen sort first (MinValue), then the
            // longest-ago ones — so a spin only repeats after every other
            // option in the genre is used up, and even then it repeats the
            // stalest film rather than a random one.
            //
            // This is a preference, not a filter, on purpose: excluding seen
            // films outright would make a thin genre start failing outright
            // after a handful of spins ("no Animation challenge available"),
            // which is a worse experience than an honest repeat. Practice is
            // meant to be replayable without limit.
            // Grouped in memory rather than in SQL: this is one user's spins
            // over one week (tens of rows, bounded by the index-covered WHERE
            // above), so the round-trip saving from a GROUP BY is nil, and an
            // EF GroupBy that fails to translate throws at runtime — which
            // would take out spinning altogether rather than degrading.
            // Read failures degrade to "no history" rather than propagating.
            // Program.cs logs and continues when MigrateAsync throws, so the
            // app can genuinely be serving traffic with this table missing —
            // and an unguarded query here would turn that into a 500 on every
            // spin, taking Roulette down entirely over a feature whose only
            // job is to make repeats less likely.
            var lastSeen = new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);
            try
            {
                var since = DateTime.UtcNow - RecentSpinWindow;
                var history = await db.RouletteSpinHistory
                    .Where(h => h.UserId == userId && h.SeenAt >= since)
                    .OrderByDescending(h => h.SeenAt)
                    .Take(MaxTrackedSpinsPerUser)
                    .Select(h => new { h.ImdbId, h.SeenAt })
                    .ToListAsync();

                foreach (var group in history.GroupBy(h => h.ImdbId, StringComparer.OrdinalIgnoreCase))
                    lastSeen[group.Key] = group.Max(h => h.SeenAt);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Couldn't read Roulette spin history; spinning without repeat avoidance.");
            }

            // A genre filter that silently includes films from other genres is
            // not a genre filter, so `pool` is the ONLY source used below —
            // there is deliberately no widening to the full catalog. The
            // earlier version picked a single random target and, when that one
            // film happened to have no in-genre connections, fell back to
            // building the challenge from the whole catalog. For a thin genre
            // like Animation that fallback fired on nearly every spin, so
            // "Animation" reliably showed one animated poster on the reveal
            // card and three live-action films inside the challenge.
            //
            // The right axis to widen is the *target*, not the genre: try
            // every film in the genre and take the first that can carry a
            // challenge built entirely from its own genre. Most films clear
            // the bar (Chronos only needs three other in-genre films with
            // distinct years), so in practice the first candidate wins and
            // this is a single pass.
            //
            // Shuffle before the sort, not instead of it: OrderBy is stable,
            // so films tied on last-seen (in particular every unseen film,
            // which is the common case) stay in the random order the shuffle
            // gave them. Sorting a non-shuffled list would make the spin
            // deterministic within each tier.
            //
            // Exhausting the pool now means the genre genuinely cannot support
            // any challenge type at all, which is a fact about the catalog
            // rather than bad luck — see RouletteController.Spin, which tells
            // the player to pick another genre instead of spinning again.
            var candidates = Shuffle(rng, pool)
                .OrderBy(e => lastSeen.TryGetValue(e.Movie.ImdbId, out var seen) ? seen : DateTime.MinValue);

            foreach (var target in candidates)
            {
                // Random order so a low-connectivity movie doesn't always fail
                // (or succeed) on the same challenge type every time it's spun.
                var challengeTypes = Shuffle(rng, new[] { "connection", "chronos", "castDeduct" });
                foreach (var type in challengeTypes)
                {
                    // 4 films preferred, 3 accepted — a 3-film "which actor
                    // links these?" is still an honest challenge, and a real
                    // in-genre one beats a 4-film cross-genre one.
                    object? challenge = type switch
                    {
                        // `pool` (genre-filtered) sources the films/answer so the
                        // puzzle stays in-genre; `catalog` (full) sources the
                        // wrong-answer options so a thin genre doesn't recycle the
                        // same handful of distractors every spin.
                        "connection" => BuildConnectionForMovie(rng, pool, target, catalog, 4)
                            ?? BuildConnectionForMovie(rng, pool, target, catalog, 3),
                        "chronos" => BuildChronosForMovie(rng, pool, target, 4)
                            ?? BuildChronosForMovie(rng, pool, target, 3),
                        "castDeduct" => BuildCastDeductForMovie(rng, pool, target, catalog),
                        _ => null,
                    };
                    if (challenge != null)
                    {
                        var movie = new RouletteMovie(target.Movie.ImdbId, target.Movie.Title, target.Movie.PosterPath);
                        return new PracticeSpin(Guid.NewGuid().ToString("N"), movie, type, challenge);
                    }
                }
            }

            return null;
        }

        // Records a served spin and prunes this user's expired rows in the
        // same round-trip. Pruning here rather than on a timer keeps the table
        // self-maintaining without a background job: a user who stops playing
        // leaves at most one week of rows behind, and one who plays constantly
        // pays a trivial delete against the (UserId, SeenAt) index.
        //
        // Best-effort by design — the caller must not fail a spin because the
        // history write failed. Losing a row costs freshness on the next spin
        // and nothing else.
        public async Task RecordSpinAsync(AppDbContext db, string userId, PracticeSpin spin)
        {
            var cutoff = DateTime.UtcNow - RecentSpinWindow;

            // Age alone doesn't bound the table (see MaxTrackedSpinsPerUser),
            // so also find the timestamp of this user's Nth-newest row and
            // prune from there down. Both conditions collapse into the single
            // delete below by taking whichever cutoff is more aggressive.
            // Skip/Take becomes OFFSET/LIMIT over the (UserId, SeenAt) index,
            // so this stays one indexed lookup rather than a scan.
            var overflowCutoff = await db.RouletteSpinHistory
                .Where(h => h.UserId == userId)
                .OrderByDescending(h => h.SeenAt)
                .Skip(MaxTrackedSpinsPerUser)
                .Select(h => (DateTime?)h.SeenAt)
                .FirstOrDefaultAsync();
            if (overflowCutoff.HasValue && overflowCutoff.Value > cutoff) cutoff = overflowCutoff.Value;

            await db.RouletteSpinHistory
                .Where(h => h.UserId == userId && h.SeenAt <= cutoff)
                .ExecuteDeleteAsync();

            db.RouletteSpinHistory.Add(new RouletteSpinHistory
            {
                UserId = userId,
                ImdbId = spin.Movie.ImdbId,
                ChallengeType = spin.ChallengeType,
                SeenAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        // Every film used by the previous `RecentPuzzleDays` daily puzzles,
        // split by catalog since the movie and TV tracks draw from separate
        // tables. Used to keep a week of daily puzzles from recycling the same
        // titles — generation previously only avoided repeats *within* a
        // single day, so consecutive days could open with the same four films
        // in The Connection.
        private (HashSet<string> Movies, HashSet<string> Tv) RecentlyUsedIds(List<DailyPuzzle> recent)
        {
            var movies = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var tv = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var row in recent)
            {
                // Deserialize returning non-null is the completeness
                // guarantee here — see IsComplete. A row from before a field
                // existed (Genres/MysteryTv were both added mid-week) now
                // comes back null from Deserialize itself rather than parsing
                // "successfully" with holes in it, so every field below is
                // safe to read directly. The try/catch is defense-in-depth
                // for anything IsComplete doesn't cover (e.g. a malformed
                // list element) — this reads history of unpredictable
                // provenance, and one bad row must never take down puzzle
                // generation for every player.
                try
                {
                    var payload = Deserialize(row.ChallengePayloadJson);
                    if (payload == null) continue;

                    foreach (var m in payload.Connection.Movies) movies.Add(m.ImdbId);
                    foreach (var m in payload.Chronos.Movies) movies.Add(m.ImdbId);
                    movies.Add(payload.CastDeduct.MovieA.ImdbId);
                    movies.Add(payload.CastDeduct.MovieB.ImdbId);
                    // The scored mystery can be either media type now — file
                    // its answer in the pool it actually came from, or the
                    // exclusion never fires.
                    if (payload.MysteryMovie.MediaType == "tv") tv.Add(payload.MysteryMovie.Answer);
                    else movies.Add(payload.MysteryMovie.Answer);
                    tv.Add(payload.MysteryTv.Answer);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(
                        ex, "Couldn't read {Date}'s puzzle for repeat-avoidance; skipping that day.",
                        row.PuzzleDate);
                }
            }

            return (movies, tv);
        }

        // Same linking logic as BuildConnection, but the pool of candidate
        // people is restricted to target's own cast/director — anyone who
        // doesn't appear in target's film can't be the answer to a challenge
        // that's supposed to be about target.
        //
        // filmCount defaults to 4 (matching the daily puzzle's Connection) but
        // the caller tries 3 as a fallback — see BuildPracticeSpinAsync. A
        // 3-film "which actor links these three films?" is still an honest,
        // fully genre-pure challenge; it's a meaningfully lower bar than 4,
        // since it needs one fewer film sharing the same person out of
        // whatever pool it's searching.
        private ConnectionChallenge? BuildConnectionForMovie(
            Random rng, List<CatalogEntry> catalog, CatalogEntry target, List<CatalogEntry> distractorPool, int filmCount = 4)
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
                .Where(a => byActor.TryGetValue(a, out var list) && list.Count >= filmCount)
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
                && directorFilms.Count >= filmCount)
            {
                personKey = target.Movie.Director;
                films = directorFilms;
            }

            if (personKey == null || films == null) return null;

            // target is guaranteed a member of `films` (that's how personKey
            // was chosen), so pin it in and fill the rest randomly.
            var others = Shuffle(rng, films.Where(e => e.Movie.ImdbId != target.Movie.ImdbId))
                .Take(filmCount - 1).ToList();
            var chosen = new List<CatalogEntry> { target }.Concat(others).ToList();
            var movies = Shuffle(rng, chosen).Select(ToPuzzleMovie).ToList();

            var alsoLinksAll = useActor
                ? chosen
                    .Select(e => (IEnumerable<string>)e.Cast)
                    .Aggregate((a, b) => a.Intersect(b, StringComparer.OrdinalIgnoreCase))
                    .ToHashSet(StringComparer.OrdinalIgnoreCase)
                : new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            // Wrong-answer names come from the full distractorPool, not just the
            // in-genre films above — otherwise a thin genre recycles the same
            // few names each spin. alsoLinksAll (actors linking every shown film)
            // is still excluded, so a wider pool can't smuggle in a real second
            // answer; a director who isn't personKey can never direct all the
            // shown films, so the director case is safe without it.
            var allPeople = (useActor
                    ? distractorPool.SelectMany(e => e.Cast)
                    : distractorPool.Where(e => !string.IsNullOrWhiteSpace(e.Movie.Director)).Select(e => e.Movie.Director!))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Where(p => !string.Equals(p, personKey, StringComparison.OrdinalIgnoreCase) && !alsoLinksAll.Contains(p))
                .OrderBy(p => p, StringComparer.Ordinal)
                .ToList();

            var options = Shuffle(rng, allPeople).Take(WrongOptionCount).Append(personKey).ToList();

            return new ConnectionChallenge(movies, personKey, useActor ? "actor" : "director", Shuffle(rng, options));
        }

        // filmCount as in BuildConnectionForMovie — 4 preferred, 3 tried as a
        // genre-pure fallback before the caller widens to the full catalog.
        private ChronosChallenge? BuildChronosForMovie(
            Random rng, List<CatalogEntry> catalog, CatalogEntry target, int filmCount = 4)
        {
            var others = catalog
                .Where(e => e.Movie.ImdbId != target.Movie.ImdbId && e.Movie.ReleaseYear != target.Movie.ReleaseYear)
                .GroupBy(e => e.Movie.ReleaseYear)
                .Select(g => g.First())
                .ToList();
            if (others.Count < filmCount - 1) return null;

            var chosen = new List<CatalogEntry> { target }
                .Concat(Shuffle(rng, others).Take(filmCount - 1)).ToList();
            var correctOrder = chosen.OrderBy(e => e.Movie.ReleaseYear).Select(e => e.Movie.ImdbId).ToList();

            var presented = Shuffle(rng, chosen).Select(ToPuzzleMovie).ToList();
            if (presented.Select(m => m.ImdbId).SequenceEqual(correctOrder)) presented.Reverse();

            return new ChronosChallenge(presented, correctOrder);
        }

        private CastDeductChallenge? BuildCastDeductForMovie(Random rng, List<CatalogEntry> catalog, CatalogEntry target, List<CatalogEntry> distractorPool)
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

            // Wrong-answer actors come from the full distractorPool, not just
            // the in-genre films — same variety fix as BuildConnectionForMovie.
            // `shared` (actors in BOTH shown films) are excluded, so a wider
            // pool can't introduce a valid answer.
            var distractors = distractorPool
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
            var mysteryMovie = GradeMysteryItem(
                payload.MysteryMovie, answers.MysteryMovieGuess, answers.MysteryMovieAttemptsUsed,
                answers.MysteryMovieDifficulty);
            // Mystery TV is retired from scoring (see MaxScore) but still
            // graded so an old client that renders its result row gets a
            // truthful correct/answer — with Points forced to zero so the
            // sum can't exceed the new MaxScore.
            var mysteryTv = GradeMysteryItem(
                payload.MysteryTv, answers.MysteryTvGuess, answers.MysteryTvAttemptsUsed, difficulty: null)
                with { Points = 0 };

            var score = connection.Points + chronos.Points + castDeduct.Points
                + mysteryMovie.Points;

            // Streak and percentile are filled in by the controller, which
            // owns the database — the service stays pure so it's testable.
            return new SubmitResult(
                score, MaxScore, timeTakenMs,
                StreakCount: 0, PercentileRank: 0,
                connection, chronos, castDeduct, mysteryMovie, mysteryTv);
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

        // Points scale down with attempts used — the same "you got it, but it
        // cost you clues" tradeoff the tiered-reveal format is built around.
        // AttemptsUsed is client-reported (how many guesses it took), not
        // independently tracked server-side, since the whole clue-reveal
        // interaction happens client-side against data already sent — see
        // MysteryMovieChallenge's own comment for why that's safe here.
        //
        // Every difficulty tops out at 100 — harder means fewer attempts and
        // fewer clue tiers shown (enforced client-side; nothing here needs to
        // know which clues were actually visible), never a bigger prize.
        // That's deliberate: a variable ceiling would mean two players'
        // "max possible today" differ, which breaks the leaderboard's
        // percentile math and the stats endpoint's "perfect score" concept —
        // both assume a single fixed MaxScore for everyone.
        private static ChallengeResult GradeMysteryItem(
            MysteryMovieChallenge challenge, string? guess, int attemptsUsed, string? difficulty)
        {
            var correct = !string.IsNullOrWhiteSpace(guess)
                && string.Equals(guess.Trim(), challenge.Answer, StringComparison.OrdinalIgnoreCase);

            var points = !correct ? 0 : difficulty?.Trim().ToLowerInvariant() switch
            {
                "medium" => attemptsUsed switch { <= 1 => 100, 2 => 60, _ => 30 },
                "hard" => attemptsUsed switch { <= 1 => 100, _ => 40 },
                _ => attemptsUsed switch { <= 1 => 100, 2 => 75, 3 => 50, _ => 25 }, // easy / unrecognized
            };

            return new ChallengeResult(correct, points, correct ? null : challenge.AnswerTitle);
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
            ToCastDeductView(p.CastDeduct),
            ToMysteryMovieView(p.MysteryMovie),
            ToMysteryMovieView(p.MysteryTv));

        private static ConnectionView ToConnectionView(ConnectionChallenge c) =>
            new(c.Movies, c.LinkKind, c.Options);

        private static ChronosView ToChronosView(ChronosChallenge c) =>
            new(c.Movies.Select(m => new ChronosMovie(m.ImdbId, m.Title, m.PosterPath)).ToList());

        private static CastDeductView ToCastDeductView(CastDeductChallenge c) =>
            new(c.MovieA, c.MovieB, c.Options);

        // Drops only Answer/AnswerTitle — every clue field carries straight
        // through, per MysteryMovieChallenge's own comment. Shared by both
        // the movie and TV challenge, same as the type itself.
        private static MysteryMovieView ToMysteryMovieView(MysteryMovieChallenge c) =>
            new(c.MediaType, c.Director, c.Cast, c.Genres, c.ReleaseYear, c.Plot, c.PosterPath);

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

        // The single choke point every stored payload passes through on the
        // way back out of the database — GetOrCreateTodayAsync (today's own
        // row, and the create-race fallback), RecentlyUsedIds (the last six
        // days', for repeat avoidance), and the share-result page all call
        // this rather than JsonSerializer directly, specifically so this
        // completeness check only has to be written once.
        //
        // "Parsed without throwing" and "safe to read" are NOT the same
        // claim, and treating them as one is what broke repeat avoidance:
        // System.Text.Json fills a property missing from the JSON with null
        // rather than raising an error, so a row written before a field
        // existed (Genres and the whole MysteryTv track were both added
        // mid-week) deserializes "successfully" into an object with null
        // members a caller's C# types promise can't be null. Every caller
        // here already has correct handling for "this payload is unusable" —
        // GetOrCreateTodayAsync regenerates or 503s, RecentlyUsedIds skips
        // the day — the bug was only ever that null-but-parsed payloads
        // weren't recognized as unusable. IsComplete makes that recognition
        // happen once, here, instead of requiring every future reader to
        // remember which fields might be missing from an old row.
        private static DailyPuzzlePayload? Deserialize(string json)
        {
            try
            {
                var payload = JsonSerializer.Deserialize<DailyPuzzlePayload>(json);
                if (payload == null) return null;
                if (payload.SchemaVersion == DailyPuzzlePayload.CurrentSchemaVersion) return payload;

                // A version mismatch is not automatically "unusable" — it's
                // exactly what every row written before SchemaVersion existed
                // looks like, including a row generated by TODAY's own
                // pre-deploy code, hours before this field was added. That
                // row has every field the current record needs; it's simply
                // never had the chance to be tagged with it, and reads as
                // version 0 (System.Text.Json's default for a missing int).
                //
                // Rejecting it outright — the version check's whole point —
                // would make deploying this exact change delete and
                // regenerate TODAY's puzzle out from under anyone who already
                // played it: their score stays correct (stored separately at
                // submit time), but GameController re-grades their ORIGINAL
                // answers against the NEW payload's different correct
                // answers, corrupting their locked results view and share
                // grid with checkmarks that don't match what they actually
                // played. A structural fallback specifically catches that
                // case — "no version tag, but everything the current shape
                // needs is present" — without resurrecting a full per-field
                // checklist as the everyday path. IsComplete going stale
                // after a future field addition only makes this fallback
                // marginally more likely to reject a salvageable row (a minor
                // extra regeneration); it can never make it accept a row that
                // truly is missing something, since the version check above
                // already handles every payload written going forward.
                return IsComplete(payload) ? payload : null;
            }
            catch (JsonException)
            {
                return null;
            }
        }

        // Same fields RecentlyUsedIds used to null-check by hand — kept here
        // now only as Deserialize's version-mismatch fallback, not as the
        // primary correctness guard. See the comment above.
        private static bool IsComplete(DailyPuzzlePayload p) =>
            p.Connection?.Movies != null
            && p.Chronos?.Movies != null
            && p.CastDeduct?.MovieA != null
            && p.CastDeduct?.MovieB != null
            && p.MysteryMovie?.Answer != null
            && p.MysteryTv?.Answer != null;
    }
}
