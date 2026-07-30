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

        public GameController(
            AppDbContext db,
            IDailyPuzzleService puzzles,
            CineMindCatalogService catalog,
            IConfiguration configuration,
            ILogger<GameController> logger)
        {
            _db = db;
            _puzzles = puzzles;
            _catalog = catalog;
            _configuration = configuration;
            _logger = logger;
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
                .Select(p => new { p.PuzzleDate, p.Score })
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
                    distribution = new { perfect = 0, twoOfThree = 0, oneOfThree = 0, blank = 0 },
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
                // Bucketed by challenges solved rather than raw score, since
                // every challenge is worth the same 100 points.
                distribution = new
                {
                    perfect = rows.Count(r => r.Score == DailyPuzzleService.MaxScore),
                    twoOfThree = rows.Count(r => r.Score == DailyPuzzleService.PointsPerChallenge * 2),
                    oneOfThree = rows.Count(r => r.Score == DailyPuzzleService.PointsPerChallenge),
                    blank = rows.Count(r => r.Score == 0),
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

        private static object ToEntry(UserDailyProgress p, int rank, string callerId) => new
        {
            rank,
            userId = p.UserId,
            name = string.IsNullOrWhiteSpace(p.DisplayName) ? "Player" : p.DisplayName,
            score = p.Score,
            timeTakenMs = p.TimeTakenMs,
            streakCount = p.StreakCount,
            isYou = p.UserId == callerId,
        };

        // Names come from a client-owned Supabase profile, so they're treated
        // as untrusted input: collapsed to one line and truncated to the
        // column width, since a 60-char name with newlines would otherwise
        // wreck every row of the board.
        private static string? CleanDisplayName(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            var collapsed = string.Join(" ", raw.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
            return collapsed.Length <= 60 ? collapsed : collapsed[..60];
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
                _logger.LogWarning("Rejected catalog/seed: bad or missing x-admin-secret.");
                return Unauthorized(new { error = "Unauthorized" });
            }

            var (added, updated, failed) = await _catalog.SeedAsync(_db);
            return Ok(new { added, updated, failed, total = await _db.CineMindMovies.CountAsync() });
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
