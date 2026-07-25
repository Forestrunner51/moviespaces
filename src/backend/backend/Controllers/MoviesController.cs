using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;

namespace Backend.Controllers
{
    // Movie/TV metadata via the official OMDb API, proxied so the key stays
    // server-side. The backend maps OMDb's schema into a small internal shape
    // ({ imdbId, title, posterUrl, releaseYear }) so the client never depends
    // on the provider's JSON. Responses are cached (IMemoryCache) so repeat
    // lookups don't burn OMDb's daily request quota.
    //
    // OMDb has no "popular"/"now-playing"/list endpoint (only ?s= search and
    // ?i= lookup-by-id), so the discovery carousel is a curated set of IMDb ids
    // fetched individually — each wrapped so one failed lookup never breaks it.
    [ApiController]
    [Route("api/[controller]")]
    public class MoviesController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly IMemoryCache _cache;

        private const string BaseUrl = "https://www.omdbapi.com/";

        // Curated "Popular Movies" seed for the home carousel + the movie
        // picker's default list (OMDb can't return a popularity list). Edit
        // freely — an unknown/removed id is simply skipped, never fatal.
        private static readonly string[] PopularImdbIds = new[]
        {
            "tt1160419",  // Dune (2021)
            "tt15398776", // Oppenheimer
            "tt1517268",  // Barbie
            "tt1877830",  // The Batman
            "tt1745960",  // Top Gun: Maverick
            "tt10872600", // Spider-Man: No Way Home
            "tt4154796",  // Avengers: Endgame
            "tt0468569",  // The Dark Knight
            "tt1375666",  // Inception
            "tt0816692",  // Interstellar
            "tt6791350",  // Guardians of the Galaxy Vol. 3
            "tt9362722",  // Spider-Man: Across the Spider-Verse
        };

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
            return Ok(new { results = await SearchOmdb(query.Trim(), "movie") });
        }

        [HttpGet("search-tv")]
        public async Task<IActionResult> SearchTv([FromQuery] string query)
        {
            if (string.IsNullOrWhiteSpace(query))
            {
                return Ok(new { results = Array.Empty<object>() });
            }
            return Ok(new { results = await SearchOmdb(query.Trim(), "series") });
        }

        // Curated popular titles fetched by id in parallel (OMDb has no list
        // endpoint). Individually cached, and a failed lookup just drops out.
        [HttpGet("now-playing")]
        public async Task<IActionResult> NowPlaying()
        {
            var movies = await Task.WhenAll(PopularImdbIds.Select(GetMovieById));
            var results = movies.Where(m => m != null).Select(m => m!).ToList();
            return Ok(new { results });
        }

        // OMDb title search (?s=) → our internal shape. Returns [] on any
        // failure so the client just renders an empty state, never an error.
        private async Task<List<object>> SearchOmdb(string query, string type)
        {
            var apiKey = _configuration["Omdb:ApiKey"];
            if (string.IsNullOrWhiteSpace(apiKey))
            {
                Console.WriteLine("Omdb:ApiKey is not configured on the server.");
                return new List<object>();
            }

            var cacheKey = $"omdb:search:{type}:{query.ToLowerInvariant()}";
            if (_cache.TryGetValue(cacheKey, out List<object>? cached) && cached != null)
            {
                return cached;
            }

            var url = $"{BaseUrl}?apikey={apiKey}&s={Uri.EscapeDataString(query)}&type={type}";
            var results = new List<object>();
            try
            {
                var client = _httpClientFactory.CreateClient();
                var response = await client.GetAsync(url);
                if (!response.IsSuccessStatusCode)
                {
                    Console.WriteLine($"OMDb search error {(int)response.StatusCode}");
                    return results;
                }

                var body = await response.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(body);
                // OMDb returns { "Search": [...] } on success, or
                // { "Response": "False", "Error": "..." } when nothing matches.
                if (doc.RootElement.TryGetProperty("Search", out var search)
                    && search.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in search.EnumerateArray())
                    {
                        var mapped = MapItem(item);
                        if (mapped != null) results.Add(mapped);
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"OMDb search failed: {ex.Message}");
                return new List<object>();
            }

            _cache.Set(cacheKey, results, TimeSpan.FromHours(24));
            return results;
        }

        // OMDb lookup by id (?i=) → our internal shape. Cached 24h; returns
        // null on any failure so a single bad id never breaks the carousel.
        private async Task<object?> GetMovieById(string imdbId)
        {
            var apiKey = _configuration["Omdb:ApiKey"];
            if (string.IsNullOrWhiteSpace(apiKey)) return null;

            var cacheKey = $"omdb:id:{imdbId}";
            if (_cache.TryGetValue(cacheKey, out object? cached)) return cached;

            var url = $"{BaseUrl}?apikey={apiKey}&i={Uri.EscapeDataString(imdbId)}";
            try
            {
                var client = _httpClientFactory.CreateClient();
                var response = await client.GetAsync(url);
                if (!response.IsSuccessStatusCode) return null;

                var body = await response.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(body);
                var mapped = MapItem(doc.RootElement);
                _cache.Set(cacheKey, mapped, TimeSpan.FromHours(24));
                return mapped;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"OMDb lookup {imdbId} failed: {ex.Message}");
                return null;
            }
        }

        // Maps an OMDb object (a ?s= search item or a full ?i= detail) into
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
