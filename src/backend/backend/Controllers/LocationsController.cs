using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Linq;
using System.Text;
using System.Text.Json;

namespace Backend.Controllers
{
    // [Authorize]d like every other controller here that fronts a billed
    // third-party API — this was previously wide open with no auth at all,
    // meaning anyone on the internet, not just app users, could script
    // requests against it and run up the Google Places bill.
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class LocationsController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;

        public LocationsController(IHttpClientFactory httpClientFactory, IConfiguration configuration)
        {
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
        }

        // Proxies Google Places API (New) searchNearby so the API key never
        // ships to the client. Field-masked to the handful of fields the app
        // actually renders/stores, to stay on the cheaper Places API tier.
        //
        // Covers venues for the broader "Watch Party / Custom Venue" space
        // type, not just movie theaters — bars and community centers are
        // legitimate watch-party venues too. Route name kept as
        // "nearby-theaters" to avoid touching every frontend call site for
        // what's still fundamentally the same lookup.
        // radiusMeters: optional, defaults to 10mi — a real theater search
        // (MovieSpace/public_gathering) stays local by default, but a Watch
        // Party/custom venue search legitimately wants to go further (a
        // private event isn't tied to "my local theater" the way a real
        // screening is), so create-space.tsx passes a wider radius for that
        // case. Capped at 50000 (Google Places Nearby Search's own max) —
        // clamped rather than rejected, so a bad/huge value degrades to "as
        // far as Google allows" instead of erroring the whole search out.
        // query: optional. Nearby Search (New) has a hard 20-result cap and
        // no pagination — it's "what's physically closest," not a real
        // search, so a specific venue outside the first 20 nearest hits is
        // simply never returned no matter how the client filters that list
        // client-side (which is exactly what this replaces). When query is
        // present, this switches to Text Search (New) instead — it searches
        // by name/text (location used only as a bias, not a hard boundary),
        // so a franchise location a bit further out, or one that just didn't
        // make the "nearest 20" cut, can still be found by typing its name.
        [HttpGet("nearby-theaters")]
        public async Task<IActionResult> GetNearbyTheaters(
            [FromQuery] double latitude,
            [FromQuery] double longitude,
            [FromQuery] double? radiusMeters,
            [FromQuery] string? query)
        {
            var apiKey = _configuration["GooglePlaces:ApiKey"];
            if (string.IsNullOrEmpty(apiKey))
            {
                return StatusCode(500, new { error = "GooglePlaces:ApiKey is not configured on the server." });
            }

            var radius = Math.Clamp(radiusMeters ?? 16093.4, 1, 50000);
            var isTextSearch = !string.IsNullOrWhiteSpace(query);

            // 20 is the Places API's own cap for both searchNearby and
            // searchText — was 15 here for no real reason, which combined
            // with a 3-category search and a tight radius made results feel
            // thin even before the "can't find a specific place at all"
            // problem query search here fixes.
            string requestUrl;
            string requestJson;
            if (isTextSearch)
            {
                requestUrl = "https://places.googleapis.com/v1/places:searchText";
                requestJson = JsonSerializer.Serialize(new
                {
                    textQuery = query,
                    // locationBias (not Restriction) — prefers nearby matches
                    // without hard-excluding a real one just outside the
                    // radius, unlike Nearby Search's boundary.
                    locationBias = new { circle = new { center = new { latitude, longitude }, radius } },
                    maxResultCount = 20,
                });
            }
            else
            {
                requestUrl = "https://places.googleapis.com/v1/places:searchNearby";
                requestJson = JsonSerializer.Serialize(new
                {
                    includedTypes = new[] { "movie_theater", "bar", "community_center" },
                    maxResultCount = 20,
                    locationRestriction = new
                    {
                        circle = new { center = new { latitude, longitude }, radius },
                    },
                });
            }

            var client = _httpClientFactory.CreateClient();
            var request = new HttpRequestMessage(HttpMethod.Post, requestUrl)
            {
                Content = new StringContent(requestJson, Encoding.UTF8, "application/json"),
            };
            request.Headers.Add("X-Goog-Api-Key", apiKey);
            request.Headers.Add("X-Goog-FieldMask", "places.id,places.displayName,places.formattedAddress,places.location,places.types");

            var response = await client.SendAsync(request);
            var content = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode)
            {
                Console.WriteLine($"Google Places error: {content}");
                return StatusCode((int)response.StatusCode, new { error = "Google Places request failed." });
            }

            using var doc = JsonDocument.Parse(content);
            var theaters = new List<object>();
            if (doc.RootElement.TryGetProperty("places", out var places))
            {
                foreach (var place in places.EnumerateArray())
                {
                    var types = place.TryGetProperty("types", out var typesEl) && typesEl.ValueKind == JsonValueKind.Array
                        ? typesEl.EnumerateArray().Select(t => t.GetString()).Where(t => t != null).ToArray()
                        : Array.Empty<string>();

                    theaters.Add(new
                    {
                        placeId = place.GetProperty("id").GetString(),
                        name = place.TryGetProperty("displayName", out var dn) ? dn.GetProperty("text").GetString() : "",
                        address = place.TryGetProperty("formattedAddress", out var addr) ? addr.GetString() : "",
                        latitude = place.TryGetProperty("location", out var loc) ? loc.GetProperty("latitude").GetDouble() : (double?)null,
                        longitude = place.TryGetProperty("location", out var loc2) ? loc2.GetProperty("longitude").GetDouble() : (double?)null,
                        types,
                    });
                }
            }

            return Ok(new { theaters });
        }
    }
}
