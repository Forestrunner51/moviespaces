using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Backend.Data;

namespace Backend.Controllers
{
    // Movie/TV metadata via the official OMDb API, proxied so the key stays
    // server-side. The backend maps OMDb's schema into a small internal shape
    // ({ imdbId, title, posterUrl, releaseYear }) so the client never depends
    // on the provider's JSON. Responses are cached (IMemoryCache) so repeat
    // lookups don't burn OMDb's daily request quota.
    //
    // OMDb has no "popular"/"now-playing"/list endpoint (only ?s= search), so
    // the discovery carousel isn't served from here at all — it reads the
    // cinemind_movies rows flagged surprise_me, which already carry the
    // title/poster/year it needs. See NowPlaying.
    //
    // [Authorize]d like every other controller here that fronts a metered
    // third-party API (RouletteController, etc.) — this was previously wide
    // open with no auth at all, meaning anyone on the internet, not just app
    // users, could script requests against it and exhaust OMDb's daily quota,
    // breaking movie search for every real user.
    // Rate-limited on top of [Authorize]: auth alone only proves the caller is
    // *a* user, which doesn't stop one account from scripting enough requests
    // to exhaust the daily OMDb quota for everyone.
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    [EnableRateLimiting("metered-api")]
    public class MoviesController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly IMemoryCache _cache;
        private readonly AppDbContext _db;

        private const string BaseUrl = "https://www.omdbapi.com/";

        public MoviesController(
            IHttpClientFactory httpClientFactory,
            IConfiguration configuration,
            IMemoryCache cache,
            AppDbContext db)
        {
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _cache = cache;
            _db = db;
        }

        [HttpGet("search")]
        public async Task<IActionResult> SearchMovies([FromQuery] string query)
        {
            if (string.IsNullOrWhiteSpace(query))
            {
                return Ok(new { results = Array.Empty<object>(), message = (string?)null });
            }
            var (results, message) = await SearchOmdb(query.Trim(), "movie");
            return Ok(new { results, message });
        }

        [HttpGet("search-tv")]
        public async Task<IActionResult> SearchTv([FromQuery] string query)
        {
            if (string.IsNullOrWhiteSpace(query))
            {
                return Ok(new { results = Array.Empty<object>(), message = (string?)null });
            }
            var (results, message) = await SearchOmdb(query.Trim(), "series");
            return Ok(new { results, message });
        }

        // "Surprise Me" — 10 titles from the catalog rows flagged surprise_me,
        // shuffled deterministically by ISO week so the list is stable all
        // week and rotates every Monday with no scheduled job.
        //
        // Reads Postgres instead of calling OMDb: cinemind_movies already
        // stores title/poster/year for these exact films, so the old version
        // was making 10 lookups per cold cache to re-fetch data sitting in the
        // database — and needed a second hardcoded id list to do it, which
        // overlapped the catalog seed by 73% and drifted every time one list
        // was edited without the other. Curation now lives in one place
        // (CineMindCatalogService.SurpriseMeImdbIds → the flag), and the
        // rendered title/poster can't disagree with the catalog's copy.
        // mediaType=tv serves the same rotating list from cinemind_tv_shows,
        // so the picker's TV mode has something to show before the user types.
        // It previously rendered an empty modal in that state — searching TV
        // worked fine, but a blank list reads as broken, and the asymmetry with
        // movie mode (which pre-populates) made it look like the feature was
        // half-finished.
        //
        // No surprise_me flag on the TV side: that column exists to separate
        // "good for puzzles" from "good for browsing" within a 145-film
        // catalog, and with only 30 shows there's nothing to filter down to —
        // every one of them is a recognisable title worth showing.
        [HttpGet("now-playing")]
        public async Task<IActionResult> NowPlaying([FromQuery] string? mediaType)
        {
            // Ordering by ImdbId makes the shuffle input stable — without it
            // Postgres could return rows in any order and the "same pick all
            // week" guarantee would quietly depend on the query plan.
            List<CarouselItem> pool;
            if (string.Equals(mediaType, "tv", StringComparison.OrdinalIgnoreCase))
            {
                pool = await _db.CineMindTvShows
                    .OrderBy(m => m.ImdbId)
                    .Select(m => new CarouselItem(m.ImdbId, m.Title, m.PosterPath, m.ReleaseYear))
                    .ToListAsync();
            }
            else
            {
                pool = await _db.CineMindMovies
                    .Where(m => m.SurpriseMe)
                    .OrderBy(m => m.ImdbId)
                    .Select(m => new CarouselItem(m.ImdbId, m.Title, m.PosterPath, m.ReleaseYear))
                    .ToListAsync();

                // Nothing flagged yet — the column ships defaulted to false, so
                // between deploying this and re-running catalog/seed the flagged
                // set is empty. Falling back to the unflagged catalog keeps the
                // home screen populated through that window instead of rendering
                // an empty carousel that looks like a bug.
                if (pool.Count == 0)
                {
                    pool = await _db.CineMindMovies
                        .OrderBy(m => m.ImdbId)
                        .Select(m => new CarouselItem(m.ImdbId, m.Title, m.PosterPath, m.ReleaseYear))
                        .ToListAsync();
                }
            }

            var now = DateTime.UtcNow;
            var rng = new Random(now.Year * 100 + ISOWeek.GetWeekOfYear(now));
            for (var i = pool.Count - 1; i > 0; i--)
            {
                var j = rng.Next(i + 1);
                (pool[i], pool[j]) = (pool[j], pool[i]);
            }

            // Same { imdbId, title, posterUrl, releaseYear } shape MapItem
            // produces, so the client sees no difference. PosterPath already
            // holds the full OMDb poster URL (see CineMindCatalogService).
            var results = pool.Take(10).Select(m => new
            {
                imdbId = m.ImdbId,
                title = m.Title,
                posterUrl = m.PosterPath,
                releaseYear = (int?)m.ReleaseYear,
            }).ToList();

            return Ok(new { results });
        }

        // Shared row shape so the movie and TV branches above can assign to
        // one variable — anonymous types wouldn't unify across the two
        // queries even though the columns are identical.
        private sealed record CarouselItem(string ImdbId, string Title, string? PosterPath, int ReleaseYear);

        // OMDb title search (?s=) → our internal shape. Returns ([], null) on
        // any hard failure so the client just renders an empty state, never
        // an error. When OMDb rejects the query itself (e.g. "Too many
        // results" for something too short/generic), that reason comes back
        // as `message` so the client can tell the user to be more specific
        // instead of just looking broken.
        private async Task<(List<object> results, string? message)> SearchOmdb(string query, string type)
        {
            var apiKey = _configuration["Omdb:ApiKey"];
            if (string.IsNullOrWhiteSpace(apiKey))
            {
                Console.WriteLine("Omdb:ApiKey is not configured on the server.");
                return (new List<object>(), null);
            }

            var cacheKey = $"omdb:search:{type}:{query.ToLowerInvariant()}";
            if (_cache.TryGetValue(cacheKey, out (List<object> results, string? message) cached) && cached.results != null)
            {
                return cached;
            }

            var url = $"{BaseUrl}?apikey={apiKey}&s={Uri.EscapeDataString(query)}&type={type}";
            var results = new List<object>();
            string? message = null;
            try
            {
                var client = _httpClientFactory.CreateClient();
                var response = await client.GetAsync(url);
                if (!response.IsSuccessStatusCode)
                {
                    Console.WriteLine($"OMDb search error {(int)response.StatusCode}");
                    return (results, null);
                }

                var body = await response.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(body);
                // OMDb returns { "Search": [...] } on success, or
                // { "Response": "False", "Error": "..." } when nothing matches
                // or the query was rejected as too broad/short.
                if (doc.RootElement.TryGetProperty("Search", out var search)
                    && search.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in search.EnumerateArray())
                    {
                        var mapped = MapItem(item);
                        if (mapped != null) results.Add(mapped);
                    }
                }
                else if (doc.RootElement.TryGetProperty("Error", out var errorEl))
                {
                    var omdbError = errorEl.GetString() ?? "";
                    Console.WriteLine($"OMDb search for \"{query}\" returned: {omdbError}");
                    if (omdbError.Contains("Too many results", StringComparison.OrdinalIgnoreCase))
                    {
                        message = "Too many results — try a more specific search.";
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"OMDb search failed: {ex.Message}");
                return (new List<object>(), null);
            }

            _cache.Set(cacheKey, (results, message), TimeSpan.FromHours(24));
            return (results, message);
        }

        // Maps an OMDb ?s= search item into
        // { imdbId, title, posterUrl, releaseYear }. Returns null when it lacks
        // an id/title (e.g. an OMDb {"Response":"False"} error object). OMDb
        // uses the literal "N/A" for a missing poster → mapped to null.
        private static object? MapItem(JsonElement el)
        {
            var imdbId = GetString(el, "imdbID");
            var title = GetString(el, "Title");
            if (string.IsNullOrWhiteSpace(imdbId) || string.IsNullOrWhiteSpace(title))
            {
                return null;
            }

            var poster = GetString(el, "Poster");
            string? posterUrl = string.IsNullOrWhiteSpace(poster) || poster == "N/A" ? null : poster;

            int? releaseYear = null;
            var year = GetString(el, "Year"); // "2021" or "2019–2021" for series
            if (year.Length >= 4 && int.TryParse(year.Substring(0, 4), out var y))
            {
                releaseYear = y;
            }

            return new { imdbId, title, posterUrl, releaseYear };
        }

        private static string GetString(JsonElement el, string prop) =>
            el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String
                ? v.GetString() ?? string.Empty
                : string.Empty;
    }
}
