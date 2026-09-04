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

        public record NotifyRequest(string? Email, string? Website);

        // POST /api/site/notify — the landing page's "get the link first"
        // box. Anonymous by nature; defenses are the guest-join IP limit,
        // the honeypot, a length cap, and a shape check. Duplicates return
        // 200 (idempotent — "you're on the list" either way).
        [HttpPost("notify")]
        [AllowAnonymous]
        [EnableRateLimiting("guest-join")]
        public async Task<IActionResult> Notify([FromBody] NotifyRequest req)
        {
            if (!string.IsNullOrWhiteSpace(req.Website)) return Ok(new { ok = true }); // honeypot

            var email = (req.Email ?? "").Trim().ToLowerInvariant();
            if (email.Length is < 6 or > 320 || !email.Contains('@') || !email.Contains('.') || email.Contains(' '))
                return BadRequest(new { error = "That doesn't look like an email." });

            if (!await _db.LaunchSignups.AnyAsync(x => x.Email == email))
            {
                _db.LaunchSignups.Add(new LaunchSignup { Email = email });
                await _db.SaveChangesAsync();
            }
            return Ok(new { ok = true });
        }

        // GET /api/site/notify/list — admin-gated export for launch day.
        [HttpGet("notify/list")]
        [AllowAnonymous]
        public async Task<IActionResult> NotifyList()
        {
            var expected = _config["CineMind:AdminSecret"];
            if (string.IsNullOrWhiteSpace(expected))
                return StatusCode(500, new { error = "CineMind:AdminSecret is not configured." });
            Request.Headers.TryGetValue("x-admin-secret", out var provided);
            if (!System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                    System.Text.Encoding.UTF8.GetBytes(provided.ToString()),
                    System.Text.Encoding.UTF8.GetBytes(expected)))
                return Unauthorized(new { error = "Unauthorized" });
            var rows = await _db.LaunchSignups.OrderBy(x => x.CreatedAt)
                .Select(x => new { x.Email, x.CreatedAt }).ToListAsync();
            return Ok(new { count = rows.Count, rows });
        }

        // POST /api/site/report-hook — Supabase Database Webhook target for
        // INSERTs on public.reports. Turns "reports land in a table nobody
        // watches" into an email within seconds, which is what "timely action
        // on objectionable content" (App Review 1.2) has to actually mean.
        // Configure in Supabase: Database → Webhooks → reports/INSERT →
        // POST this URL with header x-hook-secret = Render env
        // Reports__HookSecret. 503 until both sides are configured.
        [HttpPost("report-hook")]
        [AllowAnonymous]
        [EnableRateLimiting("guest-join")]
        public async Task<IActionResult> ReportHook([FromBody] System.Text.Json.JsonElement payload)
        {
            var expected = _config["Reports:HookSecret"];
            if (string.IsNullOrWhiteSpace(expected))
                return StatusCode(503, new { error = "Reports:HookSecret is not configured." });
            Request.Headers.TryGetValue("x-hook-secret", out var provided);
            if (!System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                    System.Text.Encoding.UTF8.GetBytes(provided.ToString()),
                    System.Text.Encoding.UTF8.GetBytes(expected)))
                return Unauthorized(new { error = "Unauthorized" });

            var apiKey = _config["Resend:ApiKey"];
            if (string.IsNullOrWhiteSpace(apiKey))
                return StatusCode(503, new { error = "Resend:ApiKey is not configured." });

            string record;
            try
            {
                record = System.Text.Json.JsonSerializer.Serialize(
                    payload.TryGetProperty("record", out var r) ? r : payload,
                    new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
            }
            catch { record = payload.ToString(); }
            if (record.Length > NoteCap) record = record[..NoteCap];

            var to = _config["Feedback:To"] ?? "moviespaces.dev@gmail.com";
            var client = _httpFactory.CreateClient();
            client.DefaultRequestHeaders.Authorization = new("Bearer", apiKey);
            using var resp = await client.PostAsJsonAsync("https://api.resend.com/emails", new
            {
                from = "MovieSpaces Moderation <feedback@moviespaces.org>",
                to = new[] { to },
                subject = "⚠️ New in-app report",
                text = $"A report was just filed:\n\n{record}\n\nReview it in Supabase → reports.",
            });
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogError("Resend rejected report email: {Status}", (int)resp.StatusCode);
                return StatusCode(502, new { error = "delivery failed" });
            }
            return Ok(new { sent = true });
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
