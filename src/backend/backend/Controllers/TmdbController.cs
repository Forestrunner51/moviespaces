using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;

namespace Backend.Controllers
{
    // Proxies TMDb so the mobile app never calls TMDb directly. Two reasons:
    // 1. TMDb's rate limit is per API key, and the app previously shipped one
    //    key embedded in every install — every user's traffic shared the same
    //    ceiling, so it would start throttling everyone once usage grew.
    // 2. Caching here means N users searching the same movie only costs one
    //    real TMDb request; the rest are served out of memory.
    [ApiController]
    [Route("api/[controller]")]
    public class TmdbController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly IMemoryCache _cache;

        public TmdbController(IHttpClientFactory httpClientFactory, IConfiguration configuration, IMemoryCache cache)
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

            var cacheKey = $"tmdb:search:{query.Trim().ToLowerInvariant()}";
            var url = $"https://api.themoviedb.org/3/search/movie?query={Uri.EscapeDataString(query)}&include_adult=false";
            return await ProxyWithCache(cacheKey, url);
        }

        [HttpGet("search-tv")]
        public async Task<IActionResult> SearchTv([FromQuery] string query)
        {
            if (string.IsNullOrWhiteSpace(query))
            {
                return Ok(new { results = Array.Empty<object>() });
            }

            var cacheKey = $"tmdb:search-tv:{query.Trim().ToLowerInvariant()}";
            var url = $"https://api.themoviedb.org/3/search/tv?query={Uri.EscapeDataString(query)}&include_adult=false";
            return await ProxyWithCache(cacheKey, url);
        }

        [HttpGet("now-playing")]
        public async Task<IActionResult> NowPlaying()
        {
            const string cacheKey = "tmdb:now-playing";
            const string url = "https://api.themoviedb.org/3/movie/now_playing?region=US";
            return await ProxyWithCache(cacheKey, url);
        }

        // Caches the raw TMDb response body for 24h, keyed per query (or a
        // fixed key for now-playing). IMemoryCache is per-instance/in-process
        // — it resets on redeploy and won't share across multiple server
        // instances, which is fine at this scale; revisit with Redis only if
        // this ever runs on more than one instance.
        private async Task<IActionResult> ProxyWithCache(string cacheKey, string urlWithoutKey)
        {
            if (_cache.TryGetValue(cacheKey, out string? cached) && cached != null)
            {
                return Content(cached, "application/json");
            }

            var apiKey = _configuration["Tmdb:ApiKey"];
            if (string.IsNullOrEmpty(apiKey))
            {
                return StatusCode(500, new { error = "Tmdb:ApiKey is not configured on the server." });
            }

            var separator = urlWithoutKey.Contains('?') ? "&" : "?";
            var client = _httpClientFactory.CreateClient();
            var response = await client.GetAsync($"{urlWithoutKey}{separator}api_key={apiKey}");
            var content = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                Console.WriteLine($"TMDb error: {content}");
                return StatusCode((int)response.StatusCode, new { error = "TMDb request failed." });
            }

            _cache.Set(cacheKey, content, TimeSpan.FromHours(24));
            return Content(content, "application/json");
        }
    }
}
