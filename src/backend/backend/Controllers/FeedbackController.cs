using Backend.Data;
using Backend.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace Backend.Controllers
{
    // Beta-tester notes from the marketing site's /test checklist. Anonymous
    // by design (testers aren't app users on the web), so the guardrails are
    // the guest-join IP rate limit, hard length caps, and a honeypot field —
    // and delivery is disabled entirely until Resend is configured, so an
    // unconfigured deploy fails loudly (503) instead of dropping notes.
    //
    // Delivery is Resend's HTTP API (the account already verifies
    // moviespaces.org for Supabase's SMTP). Config, via Render env vars:
    //   Resend__ApiKey        — an API key from resend.com/api-keys
    //   Feedback__To          — destination inbox (default below)
    [ApiController]
    [Route("api/site")]
    public class FeedbackController : ControllerBase
    {
        private const int NoteCap = 4000;
        private const int MetaCap = 300;

        private readonly AppDbContext _db;
        private readonly IHttpClientFactory _httpFactory;
        private readonly IConfiguration _config;
        private readonly ILogger<FeedbackController> _logger;

        public FeedbackController(AppDbContext db, IHttpClientFactory httpFactory, IConfiguration config, ILogger<FeedbackController> logger)
        {
            _db = db;
            _httpFactory = httpFactory;
            _config = config;
            _logger = logger;
        }

        private const string ClapperKey = "clapper";
        // Presses arrive batched from the site (it flushes every ~800ms of
        // mashing), capped so one request can't jump the count absurdly.
        private const int MaxTapsPerRequest = 50;

        public record ClapperTapRequest(int? Taps);

        // GET /api/site/clapper — current global take count. Anonymous: it
        // renders on the public landing page.
        [HttpGet("clapper")]
        [AllowAnonymous]
        [EnableRateLimiting("guest-join")]
        public async Task<IActionResult> GetClapper()
        {
            var row = await _db.SiteCounters.AsNoTracking().FirstOrDefaultAsync(c => c.Key == ClapperKey);
            return Ok(new { count = row?.Count ?? 0 });
        }

        // POST /api/site/clapper — add the visitor's taps. Atomic UPSERT so
        // concurrent mashers can't lose increments; guest-join rate limit
        // (per-IP) keeps a script from inflating the count too hilariously.
        [HttpPost("clapper")]
        [AllowAnonymous]
        [EnableRateLimiting("guest-join")]
        public async Task<IActionResult> TapClapper([FromBody] ClapperTapRequest? req)
        {
            var taps = Math.Clamp(req?.Taps ?? 1, 1, MaxTapsPerRequest);
            await _db.Database.ExecuteSqlInterpolatedAsync($@"
                INSERT INTO ""SiteCounters"" (""Key"", ""Count"") VALUES ({ClapperKey}, {taps})
                ON CONFLICT (""Key"") DO UPDATE SET ""Count"" = ""SiteCounters"".""Count"" + {taps}");
            var row = await _db.SiteCounters.AsNoTracking().FirstOrDefaultAsync(c => c.Key == ClapperKey);
            return Ok(new { count = row?.Count ?? taps });
        }

        public record SiteFeedbackRequest(string? Note, string? Checklist, string? Contact, string? Website);

        [HttpPost("feedback")]
        [AllowAnonymous]
        [EnableRateLimiting("guest-join")]
        public async Task<IActionResult> SubmitFeedback([FromBody] SiteFeedbackRequest req)
        {
            // Honeypot: real users never fill a hidden "website" field.
            // Bots that do get a quiet 200 and nothing else.
            if (!string.IsNullOrWhiteSpace(req.Website)) return Ok(new { sent = true });

            var note = (req.Note ?? "").Trim();
            if (note.Length == 0) return BadRequest(new { error = "Write a note first." });
            if (note.Length > NoteCap) note = note[..NoteCap];
            var checklist = Cap(req.Checklist);
            var contact = Cap(req.Contact);

            var apiKey = _config["Resend:ApiKey"];
            if (string.IsNullOrWhiteSpace(apiKey))
            {
                _logger.LogWarning("Site feedback received but Resend:ApiKey is not configured");
                return StatusCode(503, new { error = "Feedback delivery isn't set up yet." });
            }

            var to = _config["Feedback:To"] ?? "moviespaces.dev@gmail.com";
            var text =
                note +
                (checklist is null ? "" : $"\n\n--- checklist ---\n{checklist}") +
                (contact is null ? "" : $"\n\n--- contact ---\n{contact}") +
                $"\n\n--- meta ---\nreceived {DateTime.UtcNow:u}";

            var client = _httpFactory.CreateClient();
            client.DefaultRequestHeaders.Authorization = new("Bearer", apiKey);
            using var resp = await client.PostAsJsonAsync("https://api.resend.com/emails", new
            {
                from = "MovieSpaces Beta <feedback@moviespaces.org>",
                to = new[] { to },
                subject = "Beta note from the site checklist",
                text,
            });
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogError("Resend rejected site feedback: {Status} {Body}",
                    (int)resp.StatusCode, await resp.Content.ReadAsStringAsync());
                return StatusCode(502, new { error = "Couldn't deliver the note — try the email link instead." });
            }
            return Ok(new { sent = true });
        }

        private static string? Cap(string? v)
        {
            var t = (v ?? "").Trim();
            if (t.Length == 0) return null;
            return t.Length > MetaCap ? t[..MetaCap] : t;
        }
    }
}
