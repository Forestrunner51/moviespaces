using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Backend.Data;
using Backend.Models;

namespace Backend.Controllers;

// Proxies SerpApi's Google showtimes engine so the SerpApi key never ships in
// the app, and caches results in Postgres (ShowtimeCache) so repeated lookups
// of the same movie+location don't each cost a paid SerpApi search. Route is
// pinned to api/v1/showtimes (not the repo-default api/[controller]) per spec.
[ApiController]
[Route("api/v1/showtimes")]
public class ShowtimesController : ControllerBase
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly AppDbContext _db;

    // How long a cached lookup stays fresh. Showtimes for a given day are
    // effectively static, so 6h keeps SerpApi spend low without ever serving
    // yesterday's listings.
    private static readonly TimeSpan CacheTtl = TimeSpan.FromHours(6);

    public ShowtimesController(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        AppDbContext db)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _db = db;
    }

    [HttpGet]
    [AllowAnonymous]
    public async Task<IActionResult> GetShowtimes(
        [FromQuery] string movieTitle,
        [FromQuery] string location)
    {
        if (string.IsNullOrWhiteSpace(movieTitle) || string.IsNullOrWhiteSpace(location))
        {
            return BadRequest("movieTitle and location are required.");
        }

        var cacheKey = $"{movieTitle.Trim().ToLowerInvariant()}_{location.Trim().ToLowerInvariant()}";

        // Cache hit: fresh row within the TTL. Deserialize the stored theater
        // list straight back out — no SerpApi call, no re-parsing.
        var freshCutoff = DateTime.UtcNow - CacheTtl;
        var cached = await _db.ShowtimeCaches
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.CacheKey == cacheKey && s.UpdatedAtUtc >= freshCutoff);

        if (cached != null)
        {
            var cachedTheaters = JsonSerializer.Deserialize<List<TheaterDto>>(cached.DataJson)
                                 ?? new List<TheaterDto>();
            return Ok(new ShowtimeResponseDto("cache", cachedTheaters));
        }

        // Cache miss: hit SerpApi.
        var apiKey = _configuration["SerpApi:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            Console.WriteLine("SerpApi:ApiKey is not configured on the server.");
            return Ok(new ShowtimeResponseDto("none", new List<TheaterDto>()));
        }

        List<TheaterDto> theaters;
        try
        {
            var q = Uri.EscapeDataString($"{movieTitle} {location} showtimes");
            var loc = Uri.EscapeDataString(location);
            var url = $"https://serpapi.com/search.json?engine=google&q={q}&location={loc}&api_key={apiKey}";

            var client = _httpClientFactory.CreateClient();
            var response = await client.GetAsync(url);
            var body = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                Console.WriteLine($"SerpApi error {(int)response.StatusCode}: {body}");
                return Ok(new ShowtimeResponseDto("none", new List<TheaterDto>()));
            }

            theaters = ParseShowtimes(body);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"SerpApi request failed: {ex.Message}");
            return Ok(new ShowtimeResponseDto("none", new List<TheaterDto>()));
        }

        if (theaters.Count == 0)
        {
            // Nothing to cache — a "none" now shouldn't poison the cache and
            // suppress a real result an hour later when listings appear.
            return Ok(new ShowtimeResponseDto("none", new List<TheaterDto>()));
        }

        await UpsertCache(cacheKey, theaters);
        return Ok(new ShowtimeResponseDto("live", theaters));
    }

    // SerpApi's `showtimes` is an array of *day* objects (Today / Tomorrow /
    // dated), each holding a `theaters` array; each theater has a `showing`
    // array of { name/type, time[] }. We surface the first day (today's
    // listings) and parse defensively — SerpApi omits fields freely, so every
    // access is guarded and a malformed block yields an empty list, never a 500.
    private static List<TheaterDto> ParseShowtimes(string json)
    {
        var result = new List<TheaterDto>();

        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("showtimes", out var showtimes)
            || showtimes.ValueKind != JsonValueKind.Array
            || showtimes.GetArrayLength() == 0)
        {
            return result;
        }

        var firstDay = showtimes[0];
        if (!firstDay.TryGetProperty("theaters", out var theatersEl)
            || theatersEl.ValueKind != JsonValueKind.Array)
        {
            return result;
        }

        foreach (var theater in theatersEl.EnumerateArray())
        {
            var name = GetString(theater, "name");
            if (string.IsNullOrWhiteSpace(name)) continue;

            var address = GetString(theater, "address");
            var ticketUrl = GetString(theater, "link");

            var showings = new List<ShowingDto>();
            if (theater.TryGetProperty("showing", out var showingEl)
                && showingEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var showing in showingEl.EnumerateArray())
                {
                    // SerpApi labels the format under `type`; older payloads
                    // used `name`. Default to "Standard" when unlabeled.
                    var type = GetString(showing, "type");
                    if (string.IsNullOrWhiteSpace(type)) type = GetString(showing, "name");
                    if (string.IsNullOrWhiteSpace(type)) type = "Standard";

                    var times = new List<string>();
                    if (showing.TryGetProperty("time", out var timeEl)
                        && timeEl.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var t in timeEl.EnumerateArray())
                        {
                            var s = t.ValueKind == JsonValueKind.String ? t.GetString() : null;
                            if (!string.IsNullOrWhiteSpace(s)) times.Add(s!);
                        }
                    }

                    if (times.Count > 0) showings.Add(new ShowingDto(type, times));
                }
            }

            if (showings.Count > 0)
            {
                result.Add(new TheaterDto(name, address, showings, ticketUrl));
            }
        }

        return result;
    }

    private static string GetString(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() ?? string.Empty
            : string.Empty;

    // Insert-or-update keyed on the unique CacheKey. Stores the parsed list so
    // a later cache hit skips both SerpApi and the parser above.
    private async Task UpsertCache(string cacheKey, List<TheaterDto> theaters)
    {
        var dataJson = JsonSerializer.Serialize(theaters);
        var existing = await _db.ShowtimeCaches.FirstOrDefaultAsync(s => s.CacheKey == cacheKey);

        if (existing != null)
        {
            existing.DataJson = dataJson;
            existing.UpdatedAtUtc = DateTime.UtcNow;
        }
        else
        {
            _db.ShowtimeCaches.Add(new ShowtimeCache
            {
                CacheKey = cacheKey,
                DataJson = dataJson,
                UpdatedAtUtc = DateTime.UtcNow,
            });
        }

        await _db.SaveChangesAsync();
    }
}
