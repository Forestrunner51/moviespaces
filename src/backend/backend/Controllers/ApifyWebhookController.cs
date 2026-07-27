using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Backend.Data;
using Backend.Models;
using Backend.Services;

namespace Backend.Controllers
{
    // Receives the ACTOR.RUN.SUCCEEDED webhook from the nightly Apify
    // CinemaClock scrape, pulls the run's dataset, enriches each distinct
    // film title via OMDb, and upserts movies + showtimes.
    //
    // AllowAnonymous because Apify can't present a Supabase JWT — the
    // endpoint is instead gated on a shared secret header. It is the only
    // unauthenticated write path in this backend, so the secret check runs
    // before anything else touches the DB or spends an API call.
    [ApiController]
    [Route("api/webhooks")]
    [AllowAnonymous]
    public class ApifyWebhookController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly OmdbClient _omdb;
        private readonly ILogger<ApifyWebhookController> _logger;

        public ApifyWebhookController(
            AppDbContext db,
            IHttpClientFactory httpClientFactory,
            IConfiguration configuration,
            OmdbClient omdb,
            ILogger<ApifyWebhookController> logger)
        {
            _db = db;
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _omdb = omdb;
            _logger = logger;
        }

        [HttpPost("apify-showtimes")]
        public async Task<IActionResult> IngestShowtimes([FromBody] JsonElement body)
        {
            var expectedSecret = _configuration["Apify:WebhookSecret"];
            if (string.IsNullOrWhiteSpace(expectedSecret))
            {
                _logger.LogError("Apify:WebhookSecret is not configured — refusing webhook.");
                return StatusCode(500, new { error = "Webhook secret is not configured." });
            }

            Request.Headers.TryGetValue("x-apify-secret", out var providedSecret);
            if (!CryptoSafeEquals(providedSecret.ToString(), expectedSecret))
            {
                return Unauthorized(new { error = "Unauthorized" });
            }

            var datasetId = FindDatasetId(body);
            if (string.IsNullOrWhiteSpace(datasetId))
            {
                return BadRequest(new { error = "Missing defaultDatasetId in webhook payload." });
            }

            var apifyToken = _configuration["Apify:ApiToken"];
            if (string.IsNullOrWhiteSpace(apifyToken))
            {
                _logger.LogError("Apify:ApiToken is not configured — cannot fetch dataset.");
                return StatusCode(500, new { error = "Apify API token is not configured." });
            }

            List<ScrapedShowtime> scraped;
            try
            {
                scraped = await FetchDatasetAsync(datasetId, apifyToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to fetch Apify dataset {DatasetId}.", datasetId);
                return StatusCode(502, new { error = "Couldn't fetch the Apify dataset." });
            }

            if (scraped.Count == 0)
            {
                return Ok(new { message = "No items found in dataset", processed = 0 });
            }

            // Enrich once per DISTINCT title, not once per row. A nightly
            // scrape returns hundreds of showtimes spanning only a couple
            // dozen films — enriching per row would burn OMDb's daily quota
            // on identical repeat lookups.
            var distinctTitles = scraped
                .Select(s => s.MovieTitle)
                .Where(t => !string.IsNullOrWhiteSpace(t))
                .Select(t => t!)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            var movieIdByTitle = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
            foreach (var title in distinctTitles)
            {
                var movieId = await UpsertMovieAsync(title);
                movieIdByTitle[title] = movieId;
            }

            var insertedOrUpdated = 0;
            foreach (var item in scraped)
            {
                if (string.IsNullOrWhiteSpace(item.MovieTitle)) continue;
                if (item.StartsAt == null) continue;
                if (string.IsNullOrWhiteSpace(item.TheaterName)) continue;
                if (!movieIdByTitle.TryGetValue(item.MovieTitle, out var movieId)) continue;

                await UpsertShowtimeAsync(movieId, item);
                insertedOrUpdated++;
            }

            await _db.SaveChangesAsync();

            // Purge screenings that have already happened. The 6h grace keeps
            // a film visible for the length of its own runtime rather than
            // vanishing from the app the moment it starts.
            var cutoff = DateTime.UtcNow.AddHours(-6);
            var purged = await _db.Showtimes.Where(s => s.StartsAt < cutoff).ExecuteDeleteAsync();

            _logger.LogInformation(
                "Apify ingest: {Rows} rows, {Titles} titles, {Written} showtimes written, {Purged} purged.",
                scraped.Count, distinctTitles.Count, insertedOrUpdated, purged);

            return Ok(new
            {
                success = true,
                processed = scraped.Count,
                movies = distinctTitles.Count,
                showtimes = insertedOrUpdated,
                purged,
            });
        }

        private async Task<Guid> UpsertMovieAsync(string title)
        {
            var existing = await _db.NowPlayingMovies.FirstOrDefaultAsync(m => m.Title == title);
            var metadata = await _omdb.LookupByTitleAsync(title);

            if (existing == null)
            {
                var created = new NowPlayingMovie
                {
                    Title = title,
                    ImdbId = metadata?.ImdbId,
                    Overview = metadata?.Overview,
                    PosterUrl = metadata?.PosterUrl,
                    VoteAverage = metadata?.VoteAverage,
                    ReleaseDate = metadata?.ReleaseDate,
                    UpdatedAt = DateTime.UtcNow,
                };
                _db.NowPlayingMovies.Add(created);
                // Persist now so the FK below has a real row to point at.
                await _db.SaveChangesAsync();
                return created.Id;
            }

            // Only overwrite with metadata we actually got back — a failed
            // OMDb lookup shouldn't blank out artwork we already have.
            if (metadata != null)
            {
                existing.ImdbId = metadata.ImdbId ?? existing.ImdbId;
                existing.Overview = metadata.Overview ?? existing.Overview;
                existing.PosterUrl = metadata.PosterUrl ?? existing.PosterUrl;
                existing.VoteAverage = metadata.VoteAverage ?? existing.VoteAverage;
                existing.ReleaseDate = metadata.ReleaseDate ?? existing.ReleaseDate;
            }
            existing.UpdatedAt = DateTime.UtcNow;
            return existing.Id;
        }

        private async Task UpsertShowtimeAsync(Guid movieId, ScrapedShowtime item)
        {
            var startsAt = item.StartsAt!.Value;
            var existing = await _db.Showtimes.FirstOrDefaultAsync(s =>
                s.MovieId == movieId && s.TheaterName == item.TheaterName && s.StartsAt == startsAt);

            if (existing == null)
            {
                _db.Showtimes.Add(new Showtime
                {
                    MovieId = movieId,
                    TheaterName = item.TheaterName!,
                    StartsAt = startsAt,
                    BookingLink = item.BookingLink,
                    Format = item.Format,
                    ZipCode = item.ZipCode,
                    UpdatedAt = DateTime.UtcNow,
                });
                return;
            }

            existing.BookingLink = item.BookingLink ?? existing.BookingLink;
            existing.Format = item.Format ?? existing.Format;
            existing.ZipCode = item.ZipCode ?? existing.ZipCode;
            existing.UpdatedAt = DateTime.UtcNow;
        }

        private async Task<List<ScrapedShowtime>> FetchDatasetAsync(string datasetId, string token)
        {
            var url = $"https://api.apify.com/v2/datasets/{Uri.EscapeDataString(datasetId)}/items?token={Uri.EscapeDataString(token)}&clean=true&format=json";
            var client = _httpClientFactory.CreateClient();
            var response = await client.GetAsync(url);
            response.EnsureSuccessStatusCode();

            var content = await response.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(content);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return new List<ScrapedShowtime>();

            var items = new List<ScrapedShowtime>();
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                items.Add(new ScrapedShowtime
                {
                    // Field names vary between scraper versions, so accept the
                    // common aliases rather than hard-failing on one shape.
                    MovieTitle = FirstString(el, "movieTitle", "title", "movie", "filmTitle"),
                    TheaterName = FirstString(el, "theaterName", "theatre", "theater", "cinema", "cinemaName", "venue"),
                    BookingLink = FirstString(el, "bookingLink", "bookingUrl", "url", "link", "ticketUrl"),
                    Format = FirstString(el, "format", "screenType", "presentation"),
                    ZipCode = FirstString(el, "zipCode", "zip", "postalCode"),
                    StartsAt = ParseShowtime(el),
                });
            }
            return items;
        }

        // The scraper may emit a full ISO timestamp, or a separate date +
        // clock time that have to be recombined.
        private static DateTime? ParseShowtime(JsonElement el)
        {
            var iso = FirstString(el, "showtime", "startsAt", "dateTime", "datetime", "startTime");
            if (iso != null && DateTime.TryParse(iso, CultureInfo.InvariantCulture,
                    DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var parsed))
            {
                return parsed;
            }

            var date = FirstString(el, "date", "showDate");
            var time = FirstString(el, "time", "showTime");
            if (date != null && time != null && DateTime.TryParse($"{date} {time}", CultureInfo.InvariantCulture,
                    DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var combined))
            {
                return combined;
            }

            return null;
        }

        private static string? FirstString(JsonElement el, params string[] names)
        {
            foreach (var name in names)
            {
                if (el.TryGetProperty(name, out var v)
                    && v.ValueKind == JsonValueKind.String
                    && !string.IsNullOrWhiteSpace(v.GetString()))
                {
                    return v.GetString()!.Trim();
                }
            }
            return null;
        }

        // Apify sends the dataset id at different paths depending on the
        // event/payload template, so probe the documented locations.
        private static string? FindDatasetId(JsonElement body)
        {
            foreach (var parent in new[] { "resource", "eventData" })
            {
                if (body.TryGetProperty(parent, out var el)
                    && el.ValueKind == JsonValueKind.Object
                    && el.TryGetProperty("defaultDatasetId", out var id)
                    && id.ValueKind == JsonValueKind.String)
                {
                    return id.GetString();
                }
            }

            if (body.TryGetProperty("defaultDatasetId", out var top) && top.ValueKind == JsonValueKind.String)
            {
                return top.GetString();
            }

            return null;
        }

        // Length-constant comparison so the secret can't be recovered by
        // timing repeated requests.
        private static bool CryptoSafeEquals(string a, string b)
        {
            if (string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b)) return false;
            return System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                System.Text.Encoding.UTF8.GetBytes(a),
                System.Text.Encoding.UTF8.GetBytes(b));
        }

        private class ScrapedShowtime
        {
            public string? MovieTitle { get; set; }
            public string? TheaterName { get; set; }
            public string? BookingLink { get; set; }
            public string? Format { get; set; }
            public string? ZipCode { get; set; }
            public DateTime? StartsAt { get; set; }
        }
    }
}
