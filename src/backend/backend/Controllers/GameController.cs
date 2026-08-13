using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Backend.Data;
using Backend.Models;
using Backend.Services;

namespace Backend.Controllers
{
    // CineMind — the daily cinema puzzle.
    //
    // Requires auth: the once-per-day lock, streaks and leaderboards are all
    // per-user, and an anonymous endpoint would make the lock trivially
    // bypassable.
    [ApiController]
    [Route("api/game")]
    [Authorize]
    public class GameController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly IDailyPuzzleService _puzzles;
        private readonly CineMindCatalogService _catalog;
        private readonly IConfiguration _configuration;
        private readonly ILogger<GameController> _logger;
        private readonly IProfanityFilterService _profanityFilter;

        public GameController(
            AppDbContext db,
            IDailyPuzzleService puzzles,
            CineMindCatalogService catalog,
            IConfiguration configuration,
            ILogger<GameController> logger,
            IProfanityFilterService profanityFilter)
        {
            _db = db;
            _puzzles = puzzles;
            _catalog = catalog;
            _configuration = configuration;
            _logger = logger;
            _profanityFilter = profanityFilter;
        }

        private string GetUserId() =>
            User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub")
            ?? "";

        // GET /api/game/puzzles/today
        [HttpGet("puzzles/today")]
        public async Task<IActionResult> GetToday()
        {
            var userId = GetUserId();
            if (string.IsNullOrEmpty(userId)) return Unauthorized(new { error = "Unauthorized" });

            var generated = await _puzzles.GetOrCreateTodayAsync(_db);
            if (generated == null)
            {
                return StatusCode(503, new
                {
                    error = "No puzzle available today — the film catalog needs seeding.",
                });
            }

            var (puzzle, payload) = generated.Value;
            var today = puzzle.PuzzleDate;

            var progress = await _db.UserDailyProgress
                .FirstOrDefaultAsync(p => p.UserId == userId && p.PuzzleDate == today);

            if (progress != null)
            {
                // Re-grade the stored answers so a returning player can still
                // share their grid. Only the three booleans go out — NOT the
                // correct answers, which would let someone who's played hand
                // the solutions to friends who haven't.
                var stored = SafeParse(progress.GuessHistoryJson) as SubmittedAnswers;
                var regraded = stored == null ? null : _puzzles.Grade(payload, stored, progress.TimeTakenMs);

                // Hard lock. The puzzle itself is NOT returned — a locked
                // player holding the payload could study today's answers and
                // coach friends who haven't played, which breaks the shared
                // daily comparison the whole format rests on.
                return Ok(new
                {
                    isLocked = true,
                    shareId = progress.Id,
                    puzzleNumber = puzzle.PuzzleNumber,
                    score = progress.Score,
                    maxScore = DailyPuzzleService.MaxScore,
                    timeTakenMs = progress.TimeTakenMs,
                    streakCount = progress.StreakCount,
                    completedAt = progress.CompletedAt,
                    secondsUntilNextPuzzle = SecondsUntilMidnightUtc(),
                    guessHistory = stored,
                    results = regraded == null ? null : new
                    {
                        connection = regraded.Connection.Correct,
                        chronos = regraded.Chronos.Correct,
                        castDeduct = regraded.CastDeduct.Correct,
                        mysteryMovie = regraded.MysteryMovie.Correct,
                        mysteryTv = regraded.MysteryTv.Correct,
                    },
                });
            }

            return Ok(new
            {
                isLocked = false,
                secondsUntilNextPuzzle = SecondsUntilMidnightUtc(),
                streakCount = await CurrentStreakAsync(userId, today),
                puzzle = _puzzles.ToClientView(puzzle, payload),
            });
        }

        // POST /api/game/puzzles/submit
        [HttpPost("puzzles/submit")]
        public async Task<IActionResult> Submit([FromBody] SubmitRequest request)
        {
            var userId = GetUserId();
            if (string.IsNullOrEmpty(userId)) return Unauthorized(new { error = "Unauthorized" });

            var generated = await _puzzles.GetOrCreateTodayAsync(_db);
            if (generated == null) return StatusCode(503, new { error = "No puzzle available today." });

            var (puzzle, payload) = generated.Value;
            var today = puzzle.PuzzleDate;

            if (await _db.UserDailyProgress.AnyAsync(p => p.UserId == userId && p.PuzzleDate == today))
            {
                return Conflict(new { error = "Already played today.", isLocked = true });
            }

            // Clamp rather than reject: a plausible-but-wrong elapsed time
            // shouldn't lose someone their streak, but an absurd one must not
            // top the "fastest time" leaderboard either.
            var timeTakenMs = Math.Clamp(request.TimeTakenMs, 0, (int)TimeSpan.FromHours(1).TotalMilliseconds);

            var graded = _puzzles.Grade(payload, request.Answers, timeTakenMs);
            var streak = await CurrentStreakAsync(userId, today) + 1;

            var row = new UserDailyProgress
            {
                UserId = userId,
                PuzzleDate = today,
                TimeTakenMs = timeTakenMs,
                Score = graded.Score,
                GuessHistoryJson = JsonSerializer.Serialize(request.Answers),
                CompletedAt = DateTime.UtcNow,
                StreakCount = streak,
                DisplayName = CleanDisplayName(request.DisplayName),
                ChallengesSolvedCount = new[]
                {
                    graded.Connection.Correct, graded.Chronos.Correct, graded.CastDeduct.Correct,
                    graded.MysteryMovie.Correct, graded.MysteryTv.Correct,
                }.Count(c => c),
            };

            try
            {
                _db.UserDailyProgress.Add(row);
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                // Lost a race with the user's own concurrent submit. The
                // unique (user_id, puzzle_date) index is what guarantees a
                // single scored attempt per day.
                _db.ChangeTracker.Clear();
                return Conflict(new { error = "Already played today.", isLocked = true });
            }

            return Ok(graded with
            {
                StreakCount = streak,
                PercentileRank = await PercentileAsync(today, graded.Score),
                ShareId = row.Id,
            });
        }

        // GET /api/game/stats
        //
        // The player's own history. A daily game's retention hook is the run
        // you don't want to break, so max streak and games played matter as
        // much as today's score — none of which today's result alone shows.
        [HttpGet("stats")]
        public async Task<IActionResult> GetStats()
        {
            var userId = GetUserId();
            if (string.IsNullOrEmpty(userId)) return Unauthorized(new { error = "Unauthorized" });

            var rows = await _db.UserDailyProgress
                .Where(p => p.UserId == userId)
                .Select(p => new { p.PuzzleDate, p.Score, p.ChallengesSolvedCount })
                .ToListAsync();

            if (rows.Count == 0)
            {
                return Ok(new
                {
                    gamesPlayed = 0,
                    currentStreak = 0,
                    maxStreak = 0,
                    perfectCount = 0,
                    averageScore = 0,
                    playedToday = false,
                    distribution = new { solved5 = 0, solved4 = 0, solved3 = 0, solved2 = 0, solved1 = 0, solved0 = 0 },
                });
            }

            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var days = rows.Select(r => r.PuzzleDate).ToHashSet();
            var playedToday = days.Contains(today);

            // Counts today only if it's actually been played — otherwise the
            // streak is still alive from yesterday and shouldn't read as broken
            // just because it isn't midnight yet.
            var currentStreak = 0;
            var cursor = playedToday ? today : today.AddDays(-1);
            while (days.Contains(cursor))
            {
                currentStreak++;
                cursor = cursor.AddDays(-1);
            }

            // Longest run anywhere in the history, not just the live one.
            var ordered = days.OrderBy(d => d).ToList();
            var maxStreak = 1;
            var run = 1;
            for (var i = 1; i < ordered.Count; i++)
            {
                run = ordered[i].DayNumber - ordered[i - 1].DayNumber == 1 ? run + 1 : 1;
                if (run > maxStreak) maxStreak = run;
            }

            return Ok(new
            {
                gamesPlayed = rows.Count,
                currentStreak,
                maxStreak,
                perfectCount = rows.Count(r => r.Score == DailyPuzzleService.MaxScore),
                averageScore = (int)Math.Round(rows.Average(r => r.Score)),
                playedToday,
                // Bucketed by ChallengesSolvedCount, not Score: Mystery
                // Movie/TV's attempt- and difficulty-scaled points mean Score
                // no longer maps cleanly to "how many of the 5 did you solve."
                distribution = new
                {
                    solved5 = rows.Count(r => r.ChallengesSolvedCount == 5),
                    solved4 = rows.Count(r => r.ChallengesSolvedCount == 4),
                    solved3 = rows.Count(r => r.ChallengesSolvedCount == 3),
                    solved2 = rows.Count(r => r.ChallengesSolvedCount == 2),
                    solved1 = rows.Count(r => r.ChallengesSolvedCount == 1),
                    solved0 = rows.Count(r => r.ChallengesSolvedCount == 0),
                },
            });
        }

        // GET /api/game/leaderboard/global
        //
        // Everyone who played today, no Space membership required — a brand
        // new user with no Spaces still has somewhere to see their result,
        // which the per-Space board alone can't give them.
        //
        // Capped at TopCount: the board is a ranking, not a directory, and an
        // unbounded list would grow with the player base and get slower every
        // day. The caller's own row is looked up separately and always
        // returned, so being outside the top still shows you your rank.
        [HttpGet("leaderboard/global")]
        public async Task<IActionResult> GetGlobalLeaderboard()
        {
            const int TopCount = 100;

            var userId = GetUserId();
            if (string.IsNullOrEmpty(userId)) return Unauthorized(new { error = "Unauthorized" });

            var today = DateOnly.FromDateTime(DateTime.UtcNow);

            // Score first, then speed — same ordering as the per-Space board,
            // so a player's rank means the same thing on both.
            var top = await _db.UserDailyProgress
                .Where(p => p.PuzzleDate == today)
                .OrderByDescending(p => p.Score)
                .ThenBy(p => p.TimeTakenMs)
                .Take(TopCount)
                .ToListAsync();

            var playedCount = await _db.UserDailyProgress.CountAsync(p => p.PuzzleDate == today);

            var leaderboard = top
                .Select((p, index) => ToEntry(p, index + 1, userId))
                .ToList();

            // The caller may be outside the top slice, so their rank is
            // computed directly rather than searched for in the list above.
            object? you = null;
            var mine = await _db.UserDailyProgress
                .FirstOrDefaultAsync(p => p.PuzzleDate == today && p.UserId == userId);
            if (mine != null)
            {
                var ahead = await _db.UserDailyProgress.CountAsync(p =>
                    p.PuzzleDate == today
                    && (p.Score > mine.Score
                        || (p.Score == mine.Score && p.TimeTakenMs < mine.TimeTakenMs)));
                you = ToEntry(mine, ahead + 1, userId);
            }

            return Ok(new
            {
                puzzleDate = today.ToString("yyyy-MM-dd"),
                playedCount,
                isTruncated = playedCount > leaderboard.Count,
                you,
                leaderboard,
            });
        }

        // Deliberately no userId here: this feeds the GLOBAL leaderboard, where
        // the other 99 rows are strangers — handing out their Supabase auth
        // UUIDs serves nothing (isYou is already computed server-side, and the
        // client keys rows on rank). The Space leaderboard is different: it's
        // membership-gated and its userIds are already visible via the member
        // list, so it keeps them.
        private static object ToEntry(UserDailyProgress p, int rank, string callerId) => new
        {
            rank,
            name = string.IsNullOrWhiteSpace(p.DisplayName) ? "Player" : p.DisplayName,
            score = p.Score,
            timeTakenMs = p.TimeTakenMs,
            streakCount = p.StreakCount,
            isYou = p.UserId == callerId,
        };

        // Names come from a client-owned Supabase profile, so they're treated
        // as untrusted input: collapsed to one line and truncated to the
        // column width, since a 60-char name with newlines would otherwise
        // wreck every row of the board. And because this name is broadcast to
        // every player on the public global leaderboard, it goes through the
        // same profanity filter as host/member names — a profane name falls
        // back to "Player" rather than being shown to everyone.
        private string? CleanDisplayName(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            var collapsed = string.Join(" ", raw.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
            var truncated = collapsed.Length <= 60 ? collapsed : collapsed[..60];
            return _profanityFilter.CleanOrFallback(truncated, "Player");
        }

        // GET /api/game/spaces/{spaceId}/leaderboard
        //
        // "Spaces" are the EXISTING Groups/GroupMembers tables — this reuses
        // them rather than introducing a parallel membership model.
        [HttpGet("spaces/{spaceId:guid}/leaderboard")]
        public async Task<IActionResult> GetSpaceLeaderboard(Guid spaceId)
        {
            var userId = GetUserId();
            if (string.IsNullOrEmpty(userId)) return Unauthorized(new { error = "Unauthorized" });

            var space = await _db.Groups.Include(g => g.Members).FirstOrDefaultAsync(g => g.Id == spaceId);
            if (space == null) return NotFound(new { error = "Space not found." });

            // Membership gate — a leaderboard exposes who played and how well,
            // so only people actually in the Space may read it.
            var isMember = space.UserId == userId || space.Members.Any(m => m.UserId == userId);
            if (!isMember) return Forbid();

            var memberIds = space.Members
                .Select(m => m.UserId)
                .Append(space.UserId)
                .Where(id => !string.IsNullOrEmpty(id))
                .Distinct()
                .ToList();

            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var rows = await _db.UserDailyProgress
                .Where(p => p.PuzzleDate == today && memberIds.Contains(p.UserId))
                .ToListAsync();

            // Name lookup comes from GroupMembers, which already stores the
            // display name — avoids a cross-database call into Supabase just
            // to render a leaderboard.
            var nameByUserId = space.Members
                .Where(m => !string.IsNullOrEmpty(m.UserId))
                .GroupBy(m => m.UserId)
                .ToDictionary(g => g.Key, g => g.First().Name);

            var leaderboard = rows
                // Score first, then speed — the game rewards being right over
                // being fast, so time is only a tiebreak.
                .OrderByDescending(p => p.Score)
                .ThenBy(p => p.TimeTakenMs)
                .Select((p, index) => new
                {
                    rank = index + 1,
                    userId = p.UserId,
                    name = nameByUserId.TryGetValue(p.UserId, out var n) && !string.IsNullOrWhiteSpace(n)
                        ? n
                        : (p.UserId == space.UserId ? space.HostName : "Player"),
                    score = p.Score,
                    timeTakenMs = p.TimeTakenMs,
                    streakCount = p.StreakCount,
                    isYou = p.UserId == userId,
                })
                .ToList();

            return Ok(new
            {
                spaceId,
                spaceName = space.FilmName,
                puzzleDate = today.ToString("yyyy-MM-dd"),
                playedCount = leaderboard.Count,
                memberCount = memberIds.Count,
                leaderboard,
            });
        }

        // GET /api/game/catalog/browse
        //
        // Every catalog film's identifying info (title/year/director/cast),
        // for Mystery Movie's guess autocomplete — searched and matched
        // entirely client-side. Deliberately not a live per-keystroke OMDb
        // search: OMDb's free tier has a daily request cap already flagged
        // as a real constraint elsewhere in this project, and a guess has to
        // resolve to a catalog film anyway (it needs Director/Cast/Year to
        // compare against for near-miss feedback, and to possibly BE the
        // answer) — a search that could return non-catalog films would just
        // be guesses that can never be right.
        //
        // Handing over the full catalog list this way doesn't weaken
        // anything: Connection and Chronos already show real posters/titles
        // from this same catalog in their own un-redacted views every day.
        // This isn't hiding "which movies are possible," only which one is
        // today's answer.
        // mediaType=tv returns the (separate, smaller, Director-less) TV
        // catalog instead — Mystery Movie's TV track needs its own
        // autocomplete list, same reasoning as the movie one above.
        [HttpGet("catalog/browse")]
        public async Task<IActionResult> BrowseCatalog([FromQuery] string? mediaType)
        {
            var userId = GetUserId();
            if (string.IsNullOrEmpty(userId)) return Unauthorized(new { error = "Unauthorized" });

            if (string.Equals(mediaType, "tv", StringComparison.OrdinalIgnoreCase))
            {
                var shows = await _db.CineMindTvShows.OrderBy(m => m.Title).ToListAsync();
                return Ok(new
                {
                    movies = shows.Select(m => new
                    {
                        imdbId = m.ImdbId,
                        title = m.Title,
                        releaseYear = m.ReleaseYear,
                        director = (string?)null,
                        cast = SafeParseStringList(m.CastJson),
                        posterPath = m.PosterPath,
                    }),
                });
            }

            var movies = await _db.CineMindMovies.OrderBy(m => m.Title).ToListAsync();
            var result = movies.Select(m => new
            {
                imdbId = m.ImdbId,
                title = m.Title,
                releaseYear = m.ReleaseYear,
                director = m.Director,
                cast = SafeParseStringList(m.CastJson),
                posterPath = m.PosterPath,
            });

            return Ok(new { movies = result });
        }

        private static List<string> SafeParseStringList(string json)
        {
            try { return JsonSerializer.Deserialize<List<string>>(json) ?? new(); }
            catch (JsonException) { return new(); }
        }

        // POST /api/game/catalog/seed
        //
        // One-shot admin action, gated on a shared secret — there's no admin
        // role in this project, and an unauthenticated seed endpoint would
        // let anyone burn the OMDb daily request quota.
        // AllowAnonymous is required, not incidental: this controller is
        // [Authorize]d for the per-user game endpoints, but seeding is an
        // operator action run from a shell with no Supabase JWT to present.
        // Without this the JWT challenge rejects the request before the
        // admin-secret check below ever runs, so no secret value can work.
        [HttpPost("catalog/seed")]
        [AllowAnonymous]
        public async Task<IActionResult> SeedCatalog()
        {
            var authError = CheckAdminSecret();
            if (authError != null) return authError;

            var (added, updated, failed) = await _catalog.SeedAsync(_db);
            return Ok(new { added, updated, failed, total = await _db.CineMindMovies.CountAsync() });
        }

        // POST /api/game/catalog/seed-tv — same admin-gated one-shot pattern,
        // separate endpoint since it's a genuinely separate catalog/table.
        [HttpPost("catalog/seed-tv")]
        [AllowAnonymous]
        public async Task<IActionResult> SeedTvCatalog()
        {
            var authError = CheckAdminSecret();
            if (authError != null) return authError;

            var (added, updated, failed) = await _catalog.SeedTvAsync(_db);
            return Ok(new { added, updated, failed, total = await _db.CineMindTvShows.CountAsync() });
        }

        // POST /api/game/puzzles/today/regen
        //
        // Deletes today's persisted DailyPuzzle row so the next GET
        // puzzles/today regenerates it from the current catalog. Needed
        // because GetOrCreateTodayAsync snapshots the catalog once per day —
        // a catalog/seed re-run (e.g. backfilling Genre/Plot onto existing
        // rows) doesn't retroactively touch a day that already generated.
        //
        // Refuses once anyone has completed today's puzzle: regenerating out
        // from under a submitted result would change the correct answers
        // retroactively, corrupting that player's already-recorded score and
        // share grid (see the "people already played and shared" comment on
        // DailyPuzzle itself).
        [HttpPost("puzzles/today/regen")]
        [AllowAnonymous]
        public async Task<IActionResult> RegenerateTodayPuzzle()
        {
            var authError = CheckAdminSecret();
            if (authError != null) return authError;

            var today = DateOnly.FromDateTime(DateTime.UtcNow);

            var alreadyPlayed = await _db.UserDailyProgress.AnyAsync(p => p.PuzzleDate == today);
            if (alreadyPlayed)
            {
                return Conflict(new
                {
                    error = "Refusing to regenerate — at least one player has already completed today's puzzle.",
                });
            }

            var existing = await _db.DailyPuzzles.FirstOrDefaultAsync(p => p.PuzzleDate == today);
            if (existing == null)
            {
                return Ok(new { regenerated = false, reason = "No puzzle existed yet for today." });
            }

            _db.DailyPuzzles.Remove(existing);
            await _db.SaveChangesAsync();
            return Ok(new { regenerated = true });
        }

        private IActionResult? CheckAdminSecret()
        {
            var expected = _configuration["CineMind:AdminSecret"];
            if (string.IsNullOrWhiteSpace(expected))
            {
                return StatusCode(500, new { error = "CineMind:AdminSecret is not configured." });
            }

            Request.Headers.TryGetValue("x-admin-secret", out var provided);
            if (!System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                    System.Text.Encoding.UTF8.GetBytes(provided.ToString()),
                    System.Text.Encoding.UTF8.GetBytes(expected)))
            {
                _logger.LogWarning("Rejected admin-gated catalog endpoint: bad or missing x-admin-secret.");
                return Unauthorized(new { error = "Unauthorized" });
            }

            return null;
        }

        // ── Helpers ────────────────────────────────────────────────────────

        // Consecutive days played, counting back from the day BEFORE `today`
        // (today isn't recorded yet when this is called on submit).
        private async Task<int> CurrentStreakAsync(string userId, DateOnly today)
        {
            // 400 days is far past any realistic streak and bounds the scan.
            var since = today.AddDays(-400);
            var played = await _db.UserDailyProgress
                .Where(p => p.UserId == userId && p.PuzzleDate < today && p.PuzzleDate >= since)
                .Select(p => p.PuzzleDate)
                .ToListAsync();

            var days = played.ToHashSet();
            var streak = 0;
            var cursor = today.AddDays(-1);
            while (days.Contains(cursor))
            {
                streak++;
                cursor = cursor.AddDays(-1);
            }
            return streak;
        }

        // Share of today's players this score beats or matches.
        private async Task<int> PercentileAsync(DateOnly date, int score)
        {
            var total = await _db.UserDailyProgress.CountAsync(p => p.PuzzleDate == date);
            if (total <= 1) return 100;

            var beaten = await _db.UserDailyProgress
                .CountAsync(p => p.PuzzleDate == date && p.Score <= score);
            return (int)Math.Round(100.0 * beaten / total);
        }

        // GET /cinemind-result/{id}
        //
        // What generateShareGrid actually links to now, instead of pasting the
        // whole spoiler-free grid as raw emoji text into the message body —
        // a real webpage a recipient can open reads as a legitimate share
        // (same pattern as the Space invite page), not a wall of copy-pasted
        // symbols. AllowAnonymous: the recipient hasn't necessarily played
        // today and shouldn't need to sign in just to see a friend's score.
        //
        // No answers, no puzzle payload, no PII beyond what the plain-text
        // grid already showed — same spoiler-free constraint, same content,
        // just rendered as HTML instead of emoji lines.
        [HttpGet("/cinemind-result/{id:guid}")]
        [AllowAnonymous]
        public async Task<IActionResult> ResultPage(Guid id)
        {
            var progress = await _db.UserDailyProgress.FirstOrDefaultAsync(p => p.Id == id);
            if (progress == null) return NotFound();

            var dailyPuzzle = await _db.DailyPuzzles.FirstOrDefaultAsync(p => p.PuzzleDate == progress.PuzzleDate);
            var payload = dailyPuzzle != null ? _puzzles.DeserializePayload(dailyPuzzle.ChallengePayloadJson) : null;
            var stored = SafeParse(progress.GuessHistoryJson) as SubmittedAnswers;
            var regraded = (payload != null && stored != null)
                ? _puzzles.Grade(payload, stored, progress.TimeTakenMs)
                : null;

            var puzzleNumber = dailyPuzzle?.PuzzleNumber ?? 0;
            var isPerfect = progress.Score == DailyPuzzleService.MaxScore;
            var timeText = System.Net.WebUtility.HtmlEncode(FormatDuration(progress.TimeTakenMs));
            var iosStoreUrl = System.Net.WebUtility.HtmlEncode(_configuration["AppLinks:IosStoreUrl"] ?? "");
            var androidStoreUrl = System.Net.WebUtility.HtmlEncode(_configuration["AppLinks:AndroidStoreUrl"] ?? "");

            // A small filled/outline dot instead of 🟩/🟥 — same reasoning as
            // the rest of the app's emoji sweep: renders identically on every
            // platform, takes its colour from the palette instead of a fixed
            // emoji hue, and sits on the text baseline properly.
            string Row(string label, bool? correct) =>
                correct == null
                    ? ""
                    : $@"<div class='row'>
                            <span class='dot {(correct.Value ? "dot-yes" : "dot-no")}'></span>
                            {System.Net.WebUtility.HtmlEncode(label)}
                        </div>";

            var html = $@"
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset='utf-8'>
            <meta name='viewport' content='width=device-width, initial-scale=1'>
            <title>CineMind #{puzzleNumber} - MovieSpaces</title>
            <meta property='og:title' content='CineMind #{puzzleNumber} — {progress.Score}/{DailyPuzzleService.MaxScore}'>
            <meta property='og:description' content='A daily 3-minute movie puzzle. Can you beat this score?'>
            <style>
                * {{ margin: 0; padding: 0; box-sizing: border-box; }}
                body {{
                    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                    background: #16100D;
                    color: #F7F0E8;
                    min-height: 100vh;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 24px;
                }}
                .card {{ background: #221913; border: 1px solid rgba(247,240,232,0.10); border-radius: 20px; padding: 32px; max-width: 400px; width: 100%; text-align: center; }}
                .eyebrow {{ font-size: 13px; color: #B3A296; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 16px; }}
                .score {{ font-size: 64px; font-weight: 800; line-height: 1; margin-bottom: 6px; }}
                .score span {{ font-size: 26px; color: #B3A296; font-weight: 600; }}
                .meta {{ color: #B3A296; font-size: 14px; margin-bottom: 20px; }}
                .streak {{ color: #EF8A3C; font-weight: 700; }}
                .perfect {{
                    display: inline-block;
                    color: #EF8A3C;
                    font-weight: 700;
                    font-size: 13px;
                    letter-spacing: 0.5px;
                    text-transform: uppercase;
                    background: rgba(239,138,60,0.14);
                    border: 1px solid rgba(239,138,60,0.38);
                    border-radius: 999px;
                    padding: 5px 14px;
                    margin-bottom: 20px;
                }}
                .rows {{ background: #2B201A; border-radius: 12px; padding: 6px 16px; margin-bottom: 24px; text-align: left; }}
                .row {{ display: flex; align-items: center; gap: 10px; font-size: 14px; padding: 10px 0; border-bottom: 1px solid rgba(247,240,232,0.08); }}
                .row:last-child {{ border-bottom: none; }}
                .dot {{ width: 9px; height: 9px; border-radius: 999px; flex-shrink: 0; }}
                .dot-yes {{ background: #6FBF73; }}
                .dot-no {{ background: #E0525F; }}
                .divider {{ border-top: 1px solid rgba(247,240,232,0.10); margin: 4px 0 20px; }}
                .get-app-title {{ font-size: 13px; color: #B3A296; margin-bottom: 12px; }}
                .cta {{ display: block; background: #EF8A3C; color: #16100D; font-weight: 700; padding: 14px; border-radius: 10px; text-decoration: none; margin-bottom: 8px; }}
                .store {{ display: block; padding: 13px; border-radius: 10px; background: #2B201A; color: #F7F0E8; text-decoration: none; font-size: 15px; font-weight: 600; margin-bottom: 8px; border: 1px solid rgba(247,240,232,0.10); }}
            </style>
        </head>
        <body>
            <div class='card'>
                <p class='eyebrow'>CineMind #{puzzleNumber}</p>
                <div class='score'>{progress.Score}<span>/{DailyPuzzleService.MaxScore}</span></div>
                <p class='meta'>{timeText}{(progress.StreakCount > 1 ? $" &middot; <span class='streak'>{progress.StreakCount} day streak</span>" : "")}</p>

                {(isPerfect ? "<div class='perfect'>Perfect score</div>" : "")}

                <div class='rows'>
                    {Row("The Connection", regraded?.Connection.Correct)}
                    {Row("Chronos", regraded?.Chronos.Correct)}
                    {Row("Cast Deduct", regraded?.CastDeduct.Correct)}
                    {Row("Mystery Movie", regraded?.MysteryMovie.Correct)}
                    {Row("Mystery TV", regraded?.MysteryTv.Correct)}
                </div>

                <a href='moviespaces://cinemind' class='cta'>Play Today's CineMind</a>

                <div class='divider'></div>
                <p class='get-app-title'>New here? Get the app to play</p>
                {(string.IsNullOrEmpty(iosStoreUrl) ? "" : $"<a href='{iosStoreUrl}' class='store'>Download for iPhone</a>")}
                {(string.IsNullOrEmpty(androidStoreUrl) ? "" : $"<a href='{androidStoreUrl}' class='store'>Download for Android</a>")}
            </div>
        </body>
        </html>";

            return Content(html, "text/html");
        }

        private static string FormatDuration(int ms)
        {
            var totalSeconds = Math.Max(0, ms / 1000);
            var minutes = totalSeconds / 60;
            var seconds = totalSeconds % 60;
            return minutes > 0 ? $"{minutes}m {seconds}s" : $"{seconds}s";
        }

        private static int SecondsUntilMidnightUtc()
        {
            var now = DateTime.UtcNow;
            return (int)(now.Date.AddDays(1) - now).TotalSeconds;
        }

        private static object? SafeParse(string json)
        {
            try { return JsonSerializer.Deserialize<SubmittedAnswers>(json); }
            catch (JsonException) { return null; }
        }
    }
}
