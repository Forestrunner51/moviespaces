using Microsoft.AspNetCore.Mvc;
using System.Text;
using System.Text.Json;

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
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
        [HttpGet("nearby-theaters")]
        public async Task<IActionResult> GetNearbyTheaters([FromQuery] double latitude, [FromQuery] double longitude)
        {
            var apiKey = _configuration["GooglePlaces:ApiKey"];
            if (string.IsNullOrEmpty(apiKey))
            {
                return StatusCode(500, new { error = "GooglePlaces:ApiKey is not configured on the server." });
            }

            var requestBody = new
            {
                includedTypes = new[] { "movie_theater" },
                maxResultCount = 15,
                locationRestriction = new
                {
                    circle = new
                    {
                        center = new { latitude, longitude },
                        radius = 16093.4, // 10 miles in meters
                    },
                },
            };

            var client = _httpClientFactory.CreateClient();
            var request = new HttpRequestMessage(HttpMethod.Post, "https://places.googleapis.com/v1/places:searchNearby")
            {
                Content = new StringContent(JsonSerializer.Serialize(requestBody), Encoding.UTF8, "application/json"),
            };
            request.Headers.Add("X-Goog-Api-Key", apiKey);
            request.Headers.Add("X-Goog-FieldMask", "places.id,places.displayName,places.formattedAddress,places.location");

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
                    theaters.Add(new
                    {
                        placeId = place.GetProperty("id").GetString(),
                        name = place.TryGetProperty("displayName", out var dn) ? dn.GetProperty("text").GetString() : "",
                        address = place.TryGetProperty("formattedAddress", out var addr) ? addr.GetString() : "",
                        latitude = place.TryGetProperty("location", out var loc) ? loc.GetProperty("latitude").GetDouble() : (double?)null,
                        longitude = place.TryGetProperty("location", out var loc2) ? loc2.GetProperty("longitude").GetDouble() : (double?)null,
                    });
                }
            }

            return Ok(new { theaters });
        }
    }
}
