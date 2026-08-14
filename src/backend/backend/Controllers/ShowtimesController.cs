using Backend.Data;
using Backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Backend.Controllers
{
    // Read API over the nightly-scraped showtimes cache (see
    // ShowtimesScraperService for sourcing and trade-offs). When the cache is
    // empty — flag off, scrape not yet run, or scraper broken — these return
    // empty lists, and the client's host-entry flow remains the way a Space
    // gets its showtime. Nothing in the create-space path DEPENDS on this
    // data; it only pre-fills it.
    [ApiController]
    [Route("api/showtimes")]
    [Authorize]
    public class ShowtimesController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly IConfiguration _configuration;
        private readonly ShowtimesScrapeBackgroundService _scrapeService;

        public ShowtimesController(
            AppDbContext db,
            IConfiguration configuration,
            ShowtimesScrapeBackgroundService scrapeService)
        {
            _db = db;
            _configuration = configuration;
            _scrapeService = scrapeService;
        }

        // GET /api/showtimes/theaters — the scraped theaters, nearest-first
        // when the client supplies its location.
        [HttpGet("theaters")]
        public async Task<IActionResult> GetTheaters([FromQuery] double? lat, [FromQuery] double? lng)
        {
            // Serve whatever the cache holds, but only rows that are still in
            // the future — if the scraper has been broken for days, theaters
            // whose data fully aged out drop off naturally, and the client
            // gets a lastUpdatedUtc to decide whether to warn. Data is never
            // hidden just for being old; it's hidden for being about the past.
            var todayLocal = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(-6));

            var theaters = await _db.ScrapedShowtimes
                .Where(s => s.ShowDate >= todayLocal)
                .GroupBy(s => new { s.TheaterSlug, s.TheaterName, s.Latitude, s.Longitude })
                .Select(g => new
                {
                    slug = g.Key.TheaterSlug,
                    name = g.Key.TheaterName,
                    latitude = g.Key.Latitude,
                    longitude = g.Key.Longitude,
                    movieCount = g.Select(s => s.MovieSlug).Distinct().Count(),
                })
                .ToListAsync();

            var lastUpdatedUtc = await _db.ScrapedShowtimes
                .OrderByDescending(s => s.ScrapedAtUtc)
                .Select(s => (DateTime?)s.ScrapedAtUtc)
                .FirstOrDefaultAsync();

            if (lat.HasValue && lng.HasValue)
            {
                theaters = theaters
                    .OrderBy(t => t.latitude == null || t.longitude == null
                        ? double.MaxValue
                        : SquaredDistance(lat.Value, lng.Value, t.latitude.Value, t.longitude.Value))
                    .ToList();
            }
            else
            {
                theaters = theaters.OrderBy(t => t.name).ToList();
            }

            return Ok(new { theaters, lastUpdatedUtc });
        }

        // GET /api/showtimes/theaters/{slug}?date=2026-08-15 — one theater's
        // movies and times for a date (default: the theater-local today).
        [HttpGet("theaters/{slug}")]
        public async Task<IActionResult> GetTheaterShowtimes(string slug, [FromQuery] string? date)
        {
            DateOnly day;
            if (date != null)
            {
                if (!DateOnly.TryParse(date, out day))
                    return BadRequest(new { error = "date must be YYYY-MM-DD." });
            }
            else
            {
                day = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(-6)); // Central-local today
            }

            // The dates this theater has any FUTURE data for — drives the
            // client's date chips so it never offers a day that's already
            // passed (which is what stale cache rows would otherwise do).
            var todayLocal = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(-6));
            var availableDates = await _db.ScrapedShowtimes
                .Where(s => s.TheaterSlug == slug && s.ShowDate >= todayLocal)
                .Select(s => s.ShowDate)
                .Distinct()
                .OrderBy(d => d)
                .ToListAsync();

            var lastUpdatedUtc = await _db.ScrapedShowtimes
                .Where(s => s.TheaterSlug == slug)
                .OrderByDescending(s => s.ScrapedAtUtc)
                .Select(s => (DateTime?)s.ScrapedAtUtc)
                .FirstOrDefaultAsync();

            var rows = await _db.ScrapedShowtimes
                .Where(s => s.TheaterSlug == slug && s.ShowDate == day)
                .OrderBy(s => s.MovieTitle)
                .ThenBy(s => s.StartMinutes)
                .ToListAsync();

            var movies = rows
                .GroupBy(s => new { s.MovieSlug, s.MovieTitle })
                .Select(g => new
                {
                    title = g.Key.MovieTitle,
                    slug = g.Key.MovieSlug,
                    times = g.Select(s => new
                    {
                        minutes = s.StartMinutes,
                        label = FormatTime(s.StartMinutes),
                    }).ToList(),
                })
                .ToList();

            return Ok(new
            {
                theaterSlug = slug,
                theaterName = rows.FirstOrDefault()?.TheaterName,
                date = day.ToString("yyyy-MM-dd"),
                availableDates = availableDates.Select(d => d.ToString("yyyy-MM-dd")).ToList(),
                lastUpdatedUtc,
                movies,
            });
        }

        // POST /api/showtimes/scrape — operator-only manual trigger (same
        // shared-secret gate as the other admin endpoints), for validating a
        // deploy without waiting for the 9am-UTC nightly window. Runs inline;
        // with ~40 theaters at a 3s delay expect a couple of minutes.
        [HttpPost("scrape")]
        [AllowAnonymous]
        public async Task<IActionResult> TriggerScrape(CancellationToken ct)
        {
            var expected = _configuration["CineMind:AdminSecret"];
            if (string.IsNullOrWhiteSpace(expected))
                return StatusCode(500, new { error = "CineMind:AdminSecret is not configured." });

            Request.Headers.TryGetValue("x-admin-secret", out var provided);
            if (!System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                    System.Text.Encoding.UTF8.GetBytes(provided.ToString()),
                    System.Text.Encoding.UTF8.GetBytes(expected)))
                return Unauthorized(new { error = "Unauthorized" });

            if (!_configuration.GetValue<bool>("Showtimes:Enabled"))
                return BadRequest(new { error = "Showtimes:Enabled is not true in this environment." });

            await _scrapeService.RunScrapeAsync(ct);
            var count = await _db.ScrapedShowtimes.CountAsync(ct);
            return Ok(new { showtimeRows = count });
        }

        // Relative ordering only — no need for real haversine here.
        private static double SquaredDistance(double lat1, double lng1, double lat2, double lng2)
        {
            var dLat = lat1 - lat2;
            var dLng = lng1 - lng2;
            return dLat * dLat + dLng * dLng;
        }

        private static string FormatTime(int minutes)
        {
            var h = minutes / 60;
            var m = minutes % 60;
            var suffix = h < 12 ? "AM" : "PM";
            var h12 = h % 12 == 0 ? 12 : h % 12;
            return $"{h12}:{m:D2} {suffix}";
        }
    }
}
