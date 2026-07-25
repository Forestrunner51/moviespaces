using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;

namespace Backend.Controllers
{
    // Movie/TV metadata via the MoviesDatabase API on RapidAPI, proxied so the
    // RapidAPI key never ships in the app. Replaces the old TMDb proxy —
    // MoviesDatabase offers a clear paid commercial-use tier (TMDb's free tier
    // prohibits commercial use) and returns standard IMDb ids (tt...) that
    // interoperate with ticketing deep-links / Google showtimes.
    //
    // The backend maps MoviesDatabase's schema into a small internal shape
    // ({ results: [{ imdbId, title, posterUrl, releaseYear }] }) so the client
    // never depends on the provider's JSON — swapping providers again stays a
    // backend-only change. Responses are cached in-memory (per query) so N
    // users searching the same title cost one real upstream call.
    [ApiController]
    [Route("api/[controller]")]
    public class MoviesController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly IMemoryCache _cache;

        private const string Host = "moviesdatabase.p.rapidapi.com";
        private const string BaseUrl = "https://moviesdatabase.p.rapidapi.com";

        public MoviesController(IHttpClientFactory httpClientFactory, IConfiguration configuration, IMemoryCache cache)
        {
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _cache = cache;
        }

        [HttpGet("search")]
        public async Task<IActionResult> SearchMovies([FromQuery] string query)
        {
            if (string.IsNullOrWhiteSpace(query))
            {
                return Ok(new { results = Array.Empty<object>() });
            }

            var cacheKey = $"movies:search:{query.Trim().ToLowerInvariant()}";
            // sort=year.decr surfaces the most recent match first (e.g. the 2024
            // "Dune" over the 1984 one). No startYear filter — that would hide
            // older titles the host may legitimately search for.
            var url = $"{BaseUrl}/titles/search/title/{Uri.EscapeDataString(query.Trim())}"
                    + "?exact=false&titleType=movie&sort=year.decr&info=base_info&limit=10";
            return await ProxyMapCache(cacheKey, url);
        }

        [HttpGet("search-tv")]
        public async Task<IActionResult> SearchTv([FromQuery] string query)
        {
            if (string.IsNullOrWhiteSpace(query))
            {
                return Ok(new { results = Array.Empty<object>() });
            }

            var cacheKey = $"movies:search-tv:{query.Trim().ToLowerInvariant()}";
            var url = $"{BaseUrl}/titles/search/title/{Uri.EscapeDataString(query.Trim())}"
                    + "?exact=false&titleType=tvSeries&info=base_info&limit=10";
            return await ProxyMapCache(cacheKey, url);
        }

        // "Now playing"-style discovery for the home carousel + movie picker's
        // default list. MoviesDatabase has no true "in theaters" list (the
        // box-office lists return stale titles), so use the most recent movies:
        // titleType=movie, newest-first, from the current release window.
        [HttpGet("now-playing")]
        public async Task<IActionResult> NowPlaying()
        {
            const string cacheKey = "movies:now-playing";
            // Last weekend's box office — recognizable, popular titles (the
            // recency lists returned obscure films). MoviesDatabase caps this
            // list at 10.
            var url = $"{BaseUrl}/titles?list=top_boxoffice_last_weekend_10&info=base_info&limit=10";
            return await ProxyMapCache(cacheKey, url);
        }

        // Fetches, maps MoviesDatabase's `results[]` into our internal shape,
        // and caches the mapped result for 24h. Cache holds the mapped payload
        // (not raw upstream JSON) so a hit skips both the network call and the
        // re-mapping.
        private async Task<IActionResult> ProxyMapCache(string cacheKey, string url)
        {
            if (_cache.TryGetValue(cacheKey, out List<object>? cached) && cached != null)
            {
                return Ok(new { results = cached });
            }

            var apiKey = _configuration["MoviesDatabase:ApiKey"];
            if (string.IsNullOrWhiteSpace(apiKey))
            {
                return StatusCode(500, new { error = "MoviesDatabase:ApiKey is not configured on the server." });
            }

            var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Add("x-rapidapi-key", apiKey);
            request.Headers.Add("x-rapidapi-host", Host);

            var client = _httpClientFactory.CreateClient();
            var response = await client.SendAsync(request);
            var body = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                Console.WriteLine($"MoviesDatabase error {(int)response.StatusCode}: {body}");
                return StatusCode((int)response.StatusCode, new { error = "MoviesDatabase request failed." });
            }

            var results = MapResults(body);
            _cache.Set(cacheKey, results, TimeSpan.FromHours(24));
            return Ok(new { results });
        }

        // Maps MoviesDatabase `results[]` → { imdbId, title, posterUrl,
        // releaseYear }. Every field is guarded: upcoming/niche titles routinely
        // lack primaryImage or releaseYear, and a malformed row is skipped
        // rather than throwing.
        private static List<object> MapResults(string json)
        {
            var mapped = new List<object>();

            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("results", out var results)
                || results.ValueKind != JsonValueKind.Array)
            {
                return mapped;
            }

            foreach (var item in results.EnumerateArray())
            {
                var imdbId = GetString(item, "id");
                var title = GetNestedString(item, "titleText", "text");
                if (string.IsNullOrWhiteSpace(imdbId) || string.IsNullOrWhiteSpace(title))
                {
                    continue;
                }

                string? posterUrl = null;
                if (item.TryGetProperty("primaryImage", out var img) && img.ValueKind == JsonValueKind.Object)
                {
                    var u = GetString(img, "url");
                    posterUrl = string.IsNullOrWhiteSpace(u) ? null : u;
                }

                int? releaseYear = null;
                if (item.TryGetProperty("releaseYear", out var ry) && ry.ValueKind == JsonValueKind.Object
                    && ry.TryGetProperty("year", out var y) && y.ValueKind == JsonValueKind.Number)
                {
                    releaseYear = y.GetInt32();
                }

                mapped.Add(new { imdbId, title, posterUrl, releaseYear });
            }

            return mapped;
        }

        private static string GetString(JsonElement el, string prop) =>
            el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String
                ? v.GetString() ?? string.Empty
                : string.Empty;

        private static string GetNestedString(JsonElement el, string obj, string prop) =>
            el.TryGetProperty(obj, out var inner) && inner.ValueKind == JsonValueKind.Object
                ? GetString(inner, prop)
                : string.Empty;
    }
}
