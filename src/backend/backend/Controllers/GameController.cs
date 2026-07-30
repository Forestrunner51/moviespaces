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
                    guessHistory = SafeParse(progress.GuessHistoryJson),
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
        // One-shot admin action, gated on the same shared secret the Apify
        // webhook uses — there's no admin role in this project, and an
        // unauthenticated seed endpoint would let anyone burn the OMDb daily
        // request quota.
        [HttpPost("catalog/seed")]
        public async Task<IActionResult> SeedCatalog()
        {
            var expected = _configuration["Apify:WebhookSecret"];
            if (string.IsNullOrWhiteSpace(expected))
            {
                return StatusCode(500, new { error = "Admin secret is not configured." });
            }

            Request.Headers.TryGetValue("x-admin-secret", out var provided);
            if (!System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                    System.Text.Encoding.UTF8.GetBytes(provided.ToString()),
                    System.Text.Encoding.UTF8.GetBytes(expected)))
            {
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
