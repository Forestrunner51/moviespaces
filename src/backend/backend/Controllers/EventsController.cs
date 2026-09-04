using Backend.Data;
using Backend.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using System.Text.RegularExpressions;

namespace Backend.Controllers
{
    // Minimal behavioral analytics. POST /api/events records a named event
    // for the signed-in user; GET /api/events/summary (admin-gated) returns
    // per-day counts. That's the whole system — enough to answer "how often
    // is the crew steer overridden" and "what share of sessions are
    // CineMind-only" without an analytics vendor at launch.
    [ApiController]
    [Route("api/events")]
    [Authorize]
    public partial class EventsController : ControllerBase
    {
        // Locked set: an open-ended namespace invites junk rows and typo'd
        // duplicates that make every later query a guessing game.
        private static readonly HashSet<string> AllowedEvents = new(StringComparer.Ordinal)
        {
            "onboarding_complete",
            "tour_skipped",
            "crew_created",
            "crew_joined",
            "space_created",
            "club_created",
            "club_joined",
            "steer_shown",
            "steer_find_crew",
            "steer_invite_only",
            "steer_override",
            "puzzle_submitted",
            "cinemind_bridge_tap",
            "chat_opened",
            "profile_sheet_opened",
        };

        private readonly AppDbContext _db;
        private readonly IConfiguration _config;

        public EventsController(AppDbContext db, IConfiguration config)
        {
            _db = db;
            _config = config;
        }

        public record TrackRequest(string? Name);

        [HttpPost("")]
        [EnableRateLimiting("events")]
        public async Task<IActionResult> Track([FromBody] TrackRequest req)
        {
            var userId = GetUserId();
            if (string.IsNullOrEmpty(userId)) return Unauthorized();
            var name = (req.Name ?? "").Trim();
            if (!AllowedEvents.Contains(name)) return BadRequest(new { error = "Unknown event." });

            _db.AppEvents.Add(new AppEvent { Name = name, UserId = userId });
            await _db.SaveChangesAsync();
            return Ok();
        }

        // GET /api/events/summary?days=14 — admin-gated (same x-admin-secret
        // as the seeds). Counts per event per day plus distinct users, which
        // is enough for every decision rule we've pre-committed to.
        [HttpGet("summary")]
        [AllowAnonymous]
        public async Task<IActionResult> Summary([FromQuery] int days = 14)
        {
            var expected = _config["CineMind:AdminSecret"];
            if (string.IsNullOrWhiteSpace(expected))
                return StatusCode(500, new { error = "CineMind:AdminSecret is not configured." });
            Request.Headers.TryGetValue("x-admin-secret", out var provided);
            if (!System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                    System.Text.Encoding.UTF8.GetBytes(provided.ToString()),
                    System.Text.Encoding.UTF8.GetBytes(expected)))
                return Unauthorized(new { error = "Unauthorized" });

            days = Math.Clamp(days, 1, 90);
            var since = DateTime.UtcNow.AddDays(-days);
            var rows = await _db.AppEvents
                .Where(e => e.CreatedAt >= since)
                .GroupBy(e => new { e.Name, Day = e.CreatedAt.Date })
                .Select(g => new
                {
                    name = g.Key.Name,
                    day = g.Key.Day,
                    count = g.Count(),
                    users = g.Select(e => e.UserId).Distinct().Count(),
                })
                .OrderBy(r => r.day).ThenBy(r => r.name)
                .ToListAsync();
            return Ok(new { since, rows });
        }

        private string? GetUserId() =>
            User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value;
    }
}
