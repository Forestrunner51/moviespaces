using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Backend.Models;

namespace Backend.Controllers;

// Showtimes via the International Showtimes API (RapidAPI), proxied so the key
// never ships in the app. Flow: find cinemas near the picked theater's
// coordinates (/cinemas), then pull showtimes for the movie's IMDb id at those
// cinemas (/showtimes) — the IMDb id comes from our MoviesDatabase search, so
// the two integrations line up on the standard tt-id. Results are cached
// in-memory per imdbId+location+date so we don't spend a RapidAPI call per
// retry (RapidAPI bills per request).
//
// Caching note: the spec called for a PostgreSQL/Redis table with a 6h TTL;
// this repo has neither, and a DB-backed showtime cache was just removed to
// avoid migration churn. IMemoryCache (used by MoviesController too) achieves
// the same "keep RapidAPI volume low" goal with no schema — revisit only if
// the API ever runs on multiple instances.
[ApiController]
[Route("api/[controller]")]
public class ShowtimesController : ControllerBase
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly IMemoryCache _cache;

    private const string Host = "international-showtimes.p.rapidapi.com";
    private const string BaseUrl = "https://international-showtimes.p.rapidapi.com";
    private static readonly TimeSpan CacheTtl = TimeSpan.FromHours(6);

    public ShowtimesController(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        IMemoryCache cache)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _cache = cache;
    }

    [HttpGet]
    [AllowAnonymous]
    public async Task<IActionResult> GetShowtimes(
        [FromQuery] string imdbId,
        [FromQuery] string lat,
        [FromQuery] string lng,
        [FromQuery] string? date = null)
    {
        if (string.IsNullOrWhiteSpace(imdbId) || string.IsNullOrWhiteSpace(lat) || string.IsNullOrWhiteSpace(lng))
        {
            return BadRequest("imdbId, lat and lng are required.");
        }

        // Time window: the target day 00:00Z through +48h (covers today +
        // tomorrow's listings), defaulting to "now" when no date is given.
        DateTime windowStart = DateTime.UtcNow;
        if (!string.IsNullOrWhiteSpace(date)
            && DateTime.TryParse(date, null, System.Globalization.DateTimeStyles.AssumeUniversal, out var parsed))
        {
            windowStart = DateTime.SpecifyKind(parsed.Date, DateTimeKind.Utc);
        }
        var timeFrom = windowStart.ToString("yyyy-MM-ddTHH:mm:ssZ");
        var timeTo = windowStart.AddHours(48).ToString("yyyy-MM-ddTHH:mm:ssZ");

        var cacheKey = $"showtime:{imdbId.Trim()}:{lat.Trim()},{lng.Trim()}:{windowStart:yyyy-MM-dd}";
        if (_cache.TryGetValue(cacheKey, out ShowtimeResponseDto? cached) && cached != null)
        {
            return Ok(cached with { Source = "cache" });
        }

        var apiKey = _configuration["InternationalShowtimes:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            Console.WriteLine("InternationalShowtimes:ApiKey is not configured on the server.");
            return Ok(new ShowtimeResponseDto("none", new List<ShowtimeTheaterDto>()));
        }

        try
        {
            var cinemas = await FetchNearbyCinemas(apiKey, lat.Trim(), lng.Trim());
            if (cinemas.Count == 0)
            {
                return Ok(new ShowtimeResponseDto("none", new List<ShowtimeTheaterDto>()));
            }

            var theaters = await FetchShowtimes(apiKey, imdbId.Trim(), cinemas, timeFrom, timeTo);
            if (theaters.Count == 0)
            {
                return Ok(new ShowtimeResponseDto("none", new List<ShowtimeTheaterDto>()));
            }

            var result = new ShowtimeResponseDto("live", theaters);
            _cache.Set(cacheKey, result, CacheTtl);
            return Ok(result);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"International Showtimes request failed: {ex.Message}");
            return Ok(new ShowtimeResponseDto("none", new List<ShowtimeTheaterDto>()));
        }
    }

    private sealed record CinemaInfo(string Id, string Name, string Address);

    // /cinemas → id/name/address for theaters within 20km of the coordinates.
    private async Task<Dictionary<string, CinemaInfo>> FetchNearbyCinemas(string apiKey, string lat, string lng)
    {
        var map = new Dictionary<string, CinemaInfo>();
        var url = $"{BaseUrl}/cinemas?location={Uri.EscapeDataString($"{lat},{lng}")}&distance=20&countries=US";
        using var doc = await SendRapidApi(apiKey, url);
        if (doc == null) return map;

        if (!doc.RootElement.TryGetProperty("results", out var results)
            || results.ValueKind != JsonValueKind.Array)
        {
            return map;
        }

        foreach (var c in results.EnumerateArray())
        {
            var id = GetString(c, "id");
            var name = GetString(c, "name");
            if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name)) continue;

            var address = "";
            if (c.TryGetProperty("location", out var loc) && loc.ValueKind == JsonValueKind.Object
                && loc.TryGetProperty("address", out var addr) && addr.ValueKind == JsonValueKind.Object)
            {
                address = GetString(addr, "display_text");
            }

            map[id] = new CinemaInfo(id, name, address);
        }

        return map;
    }

    // /showtimes → screening slots (start_at, format flags, ticketing links)
    // for the IMDb id at the given cinemas. Grouped back onto each cinema and
    // by screen format. Parsed defensively — a missing field skips that slot,
    // never a 500.
    private async Task<List<ShowtimeTheaterDto>> FetchShowtimes(
        string apiKey, string imdbId, Dictionary<string, CinemaInfo> cinemas, string timeFrom, string timeTo)
    {
        var cinemaIds = string.Join(",", cinemas.Keys);
        var url = $"{BaseUrl}/showtimes?cinema_id={Uri.EscapeDataString(cinemaIds)}"
                + $"&imdb_id={Uri.EscapeDataString(imdbId)}"
                + $"&time_from={Uri.EscapeDataString(timeFrom)}&time_to={Uri.EscapeDataString(timeTo)}";
        using var doc = await SendRapidApi(apiKey, url);
        if (doc == null) return new List<ShowtimeTheaterDto>();

        if (!doc.RootElement.TryGetProperty("results", out var results)
            || results.ValueKind != JsonValueKind.Array)
        {
            return new List<ShowtimeTheaterDto>();
        }

        // cinema_id -> (format -> times)
        var byCinema = new Dictionary<string, Dictionary<string, List<ShowingTimeDto>>>();

        foreach (var s in results.EnumerateArray())
        {
            var cinemaId = GetString(s, "cinema_id");
            if (!cinemas.ContainsKey(cinemaId)) continue;

            var startAt = GetString(s, "start_at");
            if (string.IsNullOrWhiteSpace(startAt)) continue;

            var format = GetBool(s, "is_imax") ? "IMAX" : GetBool(s, "is_3d") ? "3D" : "Standard";

            // First ticketing link when present; null otherwise (the client
            // falls back to a generic theater/Fandango search for booking).
            string? bookingUrl = null;
            if (s.TryGetProperty("ticketing", out var ticketing) && ticketing.ValueKind == JsonValueKind.Array)
            {
                foreach (var t in ticketing.EnumerateArray())
                {
                    var link = GetString(t, "link");
                    if (!string.IsNullOrWhiteSpace(link)) { bookingUrl = link; break; }
                }
            }

            if (!byCinema.TryGetValue(cinemaId, out var formats))
            {
                formats = new Dictionary<string, List<ShowingTimeDto>>();
                byCinema[cinemaId] = formats;
            }
            if (!formats.TryGetValue(format, out var times))
            {
                times = new List<ShowingTimeDto>();
                formats[format] = times;
            }
            times.Add(new ShowingTimeDto(startAt, bookingUrl));
        }

        var theaters = new List<ShowtimeTheaterDto>();
        foreach (var (cinemaId, formats) in byCinema)
        {
            var info = cinemas[cinemaId];
            var showings = formats
                .Where(f => f.Value.Count > 0)
                .Select(f => new ShowingDto(f.Key, f.Value))
                .ToList();
            if (showings.Count > 0)
            {
                theaters.Add(new ShowtimeTheaterDto(info.Name, info.Address, showings));
            }
        }

        return theaters;
    }

    private async Task<JsonDocument?> SendRapidApi(string apiKey, string url)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Add("x-rapidapi-key", apiKey);
        request.Headers.Add("x-rapidapi-host", Host);

        var client = _httpClientFactory.CreateClient();
        var response = await client.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            Console.WriteLine($"International Showtimes error {(int)response.StatusCode}: {body}");
            return null;
        }

        try
        {
            return JsonDocument.Parse(body);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string GetString(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() ?? string.Empty
            : string.Empty;

    private static bool GetBool(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v)
        && (v.ValueKind == JsonValueKind.True || (v.ValueKind == JsonValueKind.String && v.GetString() == "true"));
}
