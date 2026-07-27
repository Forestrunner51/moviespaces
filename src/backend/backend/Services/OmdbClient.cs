using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace Backend.Services
{
    // Metadata looked up from OMDb for a scraped film title.
    public record OmdbMovie(
        string? ImdbId,
        string Title,
        string? Overview,
        string? PosterUrl,
        decimal? VoteAverage,
        DateTime? ReleaseDate);

    // Title -> metadata lookups against OMDb, used by the nightly showtime
    // ingest to enrich scraped titles.
    //
    // OMDb's free tier has a daily request cap, and a nightly scrape can
    // return hundreds of showtime rows covering only a couple dozen distinct
    // films — so results are cached (24h, same as MoviesController) and the
    // caller is expected to look up *distinct* titles only.
    //
    // NOTE: MoviesController still has its own inline OMDb calls for the
    // search/lookup endpoints. That predates this class and is deliberately
    // left alone here — it's launch-critical and already working — but the
    // two should be consolidated onto this client post-launch.
    public class OmdbClient
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly IMemoryCache _cache;
        private readonly ILogger<OmdbClient> _logger;

        private const string BaseUrl = "https://www.omdbapi.com/";

        public OmdbClient(
            IHttpClientFactory httpClientFactory,
            IConfiguration configuration,
            IMemoryCache cache,
            ILogger<OmdbClient> logger)
        {
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _cache = cache;
            _logger = logger;
        }

        // Best-effort: returns null when the key is unset, the title isn't
        // found, or OMDb errors. Ingest still stores the showtime with the
        // raw scraped title in that case — missing artwork is better than
        // dropping a real screening.
        public async Task<OmdbMovie?> LookupByTitleAsync(string title)
        {
            var apiKey = _configuration["Omdb:ApiKey"];
            if (string.IsNullOrWhiteSpace(apiKey))
            {
                _logger.LogWarning("Omdb:ApiKey is not configured — skipping enrichment.");
                return null;
            }

            var cacheKey = $"omdb:title:{title.ToLowerInvariant()}";
            if (_cache.TryGetValue(cacheKey, out OmdbMovie? cached)) return cached;

            // ?t= is an exact-ish title lookup that returns a single full
            // record (plus imdbRating/Plot), unlike ?s= which returns a thin
            // search list with no rating or plot.
            var url = $"{BaseUrl}?apikey={apiKey}&t={Uri.EscapeDataString(title)}&type=movie";
            try
            {
                var client = _httpClientFactory.CreateClient();
                var response = await client.GetAsync(url);
                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogWarning("OMDb lookup for {Title} failed: {Status}", title, response.StatusCode);
                    return null;
                }

                var body = await response.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;

                // OMDb signals "no match" with { "Response": "False", ... }
                if (root.TryGetProperty("Response", out var respEl)
                    && string.Equals(respEl.GetString(), "False", StringComparison.OrdinalIgnoreCase))
                {
                    _cache.Set(cacheKey, (OmdbMovie?)null, TimeSpan.FromHours(24));
                    return null;
                }

                var result = new OmdbMovie(
                    ImdbId: Clean(GetString(root, "imdbID")),
                    Title: Clean(GetString(root, "Title")) ?? title,
                    Overview: Clean(GetString(root, "Plot")),
                    PosterUrl: Clean(GetString(root, "Poster")),
                    VoteAverage: ParseRating(GetString(root, "imdbRating")),
                    ReleaseDate: ParseReleased(GetString(root, "Released")));

                _cache.Set(cacheKey, result, TimeSpan.FromHours(24));
                return result;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "OMDb lookup for {Title} threw.", title);
                return null;
            }
        }

        // OMDb uses the literal string "N/A" for every missing field.
        private static string? Clean(string value) =>
            string.IsNullOrWhiteSpace(value) || value == "N/A" ? null : value;

        private static decimal? ParseRating(string value) =>
            decimal.TryParse(Clean(value), System.Globalization.NumberStyles.Any,
                System.Globalization.CultureInfo.InvariantCulture, out var rating)
                ? rating
                : null;

        // e.g. "16 Jul 2021" — always returned in this fixed en-US format.
        private static DateTime? ParseReleased(string value)
        {
            var cleaned = Clean(value);
            if (cleaned == null) return null;
            return DateTime.TryParseExact(cleaned, "dd MMM yyyy",
                System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal,
                out var parsed)
                ? parsed
                : null;
        }

        private static string GetString(JsonElement el, string prop) =>
            el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String
                ? v.GetString() ?? string.Empty
                : string.Empty;
    }
}
