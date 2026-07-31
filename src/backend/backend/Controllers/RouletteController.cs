using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Backend.Data;
using Backend.Services;

namespace Backend.Controllers
{
    // Movie Roulette — spin for a random film (optionally by genre) plus a
    // one-off practice CineMind challenge built around it.
    //
    // Deliberately separate from GameController: this never touches
    // UserDailyProgress, the streak, or the leaderboard — a spin is scratch
    // practice, not an attempt, and keeping it in its own controller with its
    // own service state (the spin cache below) makes that separation
    // structural rather than a naming convention someone has to remember.
    [ApiController]
    [Route("api/roulette")]
    [Authorize]
    public class RouletteController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly IDailyPuzzleService _puzzles;
        private readonly IMemoryCache _cache;
        private readonly ILogger<RouletteController> _logger;

        // Long enough to cover someone actually solving a 1-question practice
        // card, short enough that abandoned spins don't accumulate in memory
        // for the life of the process.
        private static readonly TimeSpan SpinTtl = TimeSpan.FromMinutes(10);

        public RouletteController(
            AppDbContext db,
            IDailyPuzzleService puzzles,
            IMemoryCache cache,
            ILogger<RouletteController> logger)
        {
            _db = db;
            _puzzles = puzzles;
            _cache = cache;
            _logger = logger;
        }

        private string GetUserId() =>
            User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub")
            ?? "";

        private static string CacheKey(string spinId) => $"roulette:spin:{spinId}";

        // GET /api/roulette/spin?genre={genre}
        [HttpGet("spin")]
        public async Task<IActionResult> Spin([FromQuery] string? genre)
        {
            if (string.IsNullOrEmpty(GetUserId())) return Unauthorized(new { error = "Unauthorized" });

            var spin = await _puzzles.BuildPracticeSpinAsync(_db, genre);
            if (spin == null)
            {
                // Two different causes collapse to the same client message on
                // purpose: whether the genre has zero films or the one
                // randomly picked just didn't have enough connections, the
                // correct next step for the player is identical — spin again
                // or try a different genre. Distinguishing them wouldn't
                // change what they should do.
                return NotFound(new
                {
                    error = string.IsNullOrWhiteSpace(genre)
                        ? "Couldn't find a movie with enough connections to build a challenge. Try spinning again."
                        : $"No luck finding a \"{genre}\" film with enough connections. Try another genre or spin again.",
                });
            }

            // The answer stays server-side, keyed by spinId — the same reason
            // the daily puzzle's payload is never returned whole. /grade looks
            // this up; nothing about the correct answer ever reaches the client.
            _cache.Set(CacheKey(spin.SpinId), spin, SpinTtl);

            return Ok(new { spinId = spin.SpinId, view = _puzzles.ToPracticeView(spin) });
        }

        // POST /api/roulette/grade
        [HttpPost("grade")]
        public IActionResult Grade([FromBody] PracticeGradeRequest request)
        {
            if (string.IsNullOrEmpty(GetUserId())) return Unauthorized(new { error = "Unauthorized" });

            if (!_cache.TryGetValue(CacheKey(request.SpinId), out PracticeSpin? spin) || spin == null)
            {
                // Expired (>10 min), already graded, or never existed — same
                // response either way, since the fix is the same: spin again.
                return NotFound(new { error = "This spin has expired. Spin again." });
            }

            // One-shot: evict immediately so retrying with a different guess
            // against the same spinId can't be used to brute-force the answer.
            _cache.Remove(CacheKey(request.SpinId));

            var result = _puzzles.GradePracticeChallenge(spin.ChallengeType, spin.Challenge, request.Answer);
            return Ok(result);
        }
    }
}
