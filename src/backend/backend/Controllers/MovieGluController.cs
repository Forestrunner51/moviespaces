using Microsoft.AspNetCore.Mvc;
using System.Net.Http.Headers;
using System.Text;

namespace Backend.Controllers
{

    [ApiController]

    [Route("api/[controller]")]
    public class MovieGluController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;

        // Paste your credentials right here inside the controller where they will be used
        private readonly string _apiKey = "WqsKdJpIYI9SwtFQygTKN9M0ocksVeoxals8pVzl";
        private readonly string _username = "INDE_6_XX";
        private readonly string _password = "z1esYgVu3ili";

        public MovieGluController(IHttpClientFactory httpClientFactory)
        {
            _httpClientFactory = httpClientFactory;
        }

        [HttpGet("cinemas")]
        public async Task<IActionResult> GetNearbyCinemas([FromQuery] string lat, [FromQuery] string lng)
        {
            // 1. Compute the Base64 Auth string dynamically when the endpoint is hit
            var plainTextBytes = Encoding.UTF8.GetBytes($"{_username}:{_password}");
            string base64AuthToken = Convert.ToBase64String(plainTextBytes);

            // 2. Create the outbound client and request
            Console.WriteLine($"Base64 being sent: {base64AuthToken}");
            Console.WriteLine($"Username being sent: {_username}");
            var client = _httpClientFactory.CreateClient();
            var request = new HttpRequestMessage(HttpMethod.Get, "https://api-gate2.movieglu.com/cinemasNearby/?n=5");

            // 3. Attach the required MovieGlu security & configuration headers
            request.Headers.Add("x-api-key", _apiKey);
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic", base64AuthToken);
            request.Headers.Add("client", "INDE_6");
            request.Headers.Add("api-version", "v201");
            request.Headers.Add("territory", "XX");

            // Send the required system clock format and coordinate pairings
            request.Headers.Add("device-datetime", DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"));
            request.Headers.Add("geolocation", $"{lat};{lng}");

            // 4. Fire the request over to MovieGlu's servers
            var response = await client.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                var errorContent = await response.Content.ReadAsStringAsync();
                Console.WriteLine($"MovieGlu error: {errorContent}");
                Console.WriteLine($"MovieGlu status: {response.StatusCode}");
                return StatusCode((int)response.StatusCode, "MovieGlu server returned an error.");

            }

            var content = await response.Content.ReadAsStringAsync();
            Console.WriteLine($"MovieGlu raw response: {content}");
            Console.WriteLine($"MovieGlu status: {response.StatusCode}");

            return Content(content, "application/json");
        }
        [HttpGet("filmssoon")]
        public async Task<IActionResult> GetFilmsComingSoon()
        {
            var client = _httpClientFactory.CreateClient();
            var request = new HttpRequestMessage(HttpMethod.Get,
                "https://api-gate2.movieglu.com/filmsComingSoon/?n=10");

            request.Headers.Add("x-api-key", _apiKey);
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic",
                Convert.ToBase64String(Encoding.UTF8.GetBytes($"{_username}:{_password}")));
            request.Headers.Add("client", "INDE_6");
            request.Headers.Add("api-version", "v201");
            request.Headers.Add("territory", "XX");
            request.Headers.Add("device-datetime", DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"));
            request.Headers.Add("geolocation", "-22.0;14.0");

            var response = await client.SendAsync(request);
            var content = await response.Content.ReadAsStringAsync();
            return Content(content, "application/json");
        }

        [HttpGet("showtimes")]
        public async Task<IActionResult> GetShowtimes([FromQuery] int cinemaId, [FromQuery] string date)
        {
            var client = _httpClientFactory.CreateClient();
            var request = new HttpRequestMessage(HttpMethod.Get,
                $"https://api-gate2.movieglu.com/cinemaShowTimes/?cinema_id={cinemaId}&date={date}");

            request.Headers.Add("x-api-key", _apiKey);
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic",
                Convert.ToBase64String(Encoding.UTF8.GetBytes($"{_username}:{_password}")));
            request.Headers.Add("client", "INDE_6");
            request.Headers.Add("api-version", "v201");
            request.Headers.Add("territory", "XX");
            request.Headers.Add("device-datetime", DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"));
            request.Headers.Add("geolocation", "-22.0;14.0");

            var response = await client.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                var errorContent = await response.Content.ReadAsStringAsync();
                Console.WriteLine($"Showtimes error: {errorContent}");
                return StatusCode((int)response.StatusCode, errorContent);
            }

            var content = await response.Content.ReadAsStringAsync();
            return Content(content, "application/json");
        }


        [HttpGet("filmshowtimes")]
        public async Task<IActionResult> GetFilmShowTimes([FromQuery] int filmId, [FromQuery] string date)
        {
            var client = _httpClientFactory.CreateClient();
            var request = new HttpRequestMessage(HttpMethod.Get,
                $"https://api-gate2.movieglu.com/filmShowTimes/?film_id={filmId}&date={date}&n=10");

            request.Headers.Add("x-api-key", _apiKey);
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic",
                Convert.ToBase64String(Encoding.UTF8.GetBytes($"{_username}:{_password}")));
            request.Headers.Add("client", "INDE_6");
            request.Headers.Add("api-version", "v201");
            request.Headers.Add("territory", "XX");
            request.Headers.Add("device-datetime", DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"));
            request.Headers.Add("geolocation", "-22.0;14.0");

            var response = await client.SendAsync(request);
            var content = await response.Content.ReadAsStringAsync();
            Console.WriteLine($"Film showtimes response: {content}");
            return Content(content, "application/json");
        }

        [HttpGet("films")]
        public async Task<IActionResult> GetFilmsNowShowing()
        {
            var client = _httpClientFactory.CreateClient();
            var request = new HttpRequestMessage(HttpMethod.Get,
                "https://api-gate2.movieglu.com/filmsNowShowing/?n=10");

            request.Headers.Add("x-api-key", _apiKey);
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic",
                Convert.ToBase64String(Encoding.UTF8.GetBytes($"{_username}:{_password}")));
            request.Headers.Add("client", "INDE_6");
            request.Headers.Add("api-version", "v201");
            request.Headers.Add("territory", "XX");
            request.Headers.Add("device-datetime", DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"));
            request.Headers.Add("geolocation", "-22.0;14.0");

            var response = await client.SendAsync(request);
            var content = await response.Content.ReadAsStringAsync();
            return Content(content, "application/json");
        }

        [HttpGet("booking")]
        public async Task<IActionResult> GetBookingUrl([FromQuery] int cinemaId, [FromQuery] int filmId, [FromQuery] string time, [FromQuery] string date)
        {
            var url = $"https://api-gate2.movieglu.com/purchaseConfirmation/?cinema_id={cinemaId}&film_id={filmId}&show_time={time}&show_date={date}";
            Console.WriteLine($"Booking URL being sent: {url}");
            var client = _httpClientFactory.CreateClient();

            var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Add("x-api-key", _apiKey);
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic",
                Convert.ToBase64String(Encoding.UTF8.GetBytes($"{_username}:{_password}")));
            request.Headers.Add("client", "INDE_6");
            request.Headers.Add("api-version", "v201");
            request.Headers.Add("territory", "XX");
            request.Headers.Add("device-datetime", DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"));
            request.Headers.Add("geolocation", "-22.0;14.0");

            var response = await client.SendAsync(request);
            var content = await response.Content.ReadAsStringAsync();
            Console.WriteLine($"Booking response: {content}");
            return Content(content, "application/json");
        }
    } // closes class
} //
