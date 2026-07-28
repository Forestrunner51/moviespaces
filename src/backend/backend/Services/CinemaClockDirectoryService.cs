using System.Text.Json;
using HtmlAgilityPack;
using Microsoft.EntityFrameworkCore;
using Backend.Data;
using Backend.Models;

namespace Backend.Services
{
    // Maintains a directory of every theater CinemaClock knows about per
    // metro — name, exact CinemaClock URL, address, and geocoded
    // coordinates — scraped directly from CinemaClock's own listing pages
    // (cinemaclock.com/{metro}/movie-theaters), NOT through the paid Apify
    // actor, which has no endpoint to list theaters.
    //
    // Why this exists: getCityShowtimes enumerates theater-by-theater and is
    // capped at 500 rows with no pagination parameter, so a metro with many
    // theaters (Dallas has 81, confirmed) can silently never reach one late
    // in CinemaClock's internal ordering — re-running with a higher maxItems
    // just returns the same leading theaters again. Knowing a theater's exact
    // URL up front lets getTheaterShowtimes fetch it directly, with no cap or
    // ordering problem, and no fuzzy name-matching either — CinemaClock's own
    // name is stored verbatim here, so a scraped theaterName can be compared
    // exactly against it.
    public class CinemaClockDirectoryService
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly ILogger<CinemaClockDirectoryService> _logger;

        // Static data, not showtimes — theaters don't open/close/rebrand
        // often, so this is refreshed on a much longer cycle than the 48h
        // showtime TTL.
        public static readonly TimeSpan DirectoryTtl = TimeSpan.FromDays(30);

        // A theater within this radius of the Google Places pick is treated
        // as the same physical building. Tight enough that two distinct
        // theaters in the same shopping center shouldn't collide, loose
        // enough to absorb small geocoding error between Google's and our
        // own geocoded coordinates for the same address.
        private const double MatchRadiusMeters = 200;

        public CinemaClockDirectoryService(
            IHttpClientFactory httpClientFactory,
            IConfiguration configuration,
            ILogger<CinemaClockDirectoryService> logger)
        {
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _logger = logger;
        }

        // CinemaClock's per-metro directory page slug. CONFIRMED against the
        // live site for "dallas" and "portland" (both follow {city}-{state}).
        // The rest follow the same pattern but are UNVERIFIED — if a metro's
        // page 404s, EnsureFreshAsync just logs and leaves that metro without
        // a directory; callers fall back to the existing metro-wide
        // fuzzy-match path exactly as before this service existed.
        private static readonly Dictionary<string, string> DirectorySlugByMetro = new(StringComparer.OrdinalIgnoreCase)
        {
            ["new-york"] = "new-york-ny",
            ["los-angeles"] = "los-angeles-ca",
            ["chicago"] = "chicago-il",
            ["houston"] = "houston-tx",
            ["boston"] = "boston-ma",
            ["san-francisco"] = "san-francisco-ca",
            ["miami"] = "miami-fl",
            ["seattle"] = "seattle-wa",
            ["atlanta"] = "atlanta-ga",
            ["dallas"] = "dallas-tx", // confirmed live
            ["philadelphia"] = "philadelphia-pa",
            ["denver"] = "denver-co",
            ["phoenix"] = "phoenix-az",
            ["minneapolis"] = "minneapolis-mn",
            ["detroit"] = "detroit-mi",
            ["portland"] = "portland-or", // confirmed live
            ["san-diego"] = "san-diego-ca",
            ["austin"] = "austin-tx",
            ["nashville"] = "nashville-tn",
            ["charlotte"] = "charlotte-nc",
            ["orlando"] = "orlando-fl",
            ["san-antonio"] = "san-antonio-tx",
            ["toronto"] = "toronto-on",
            ["montreal"] = "montreal-qc",
            ["vancouver"] = "vancouver-bc",
            ["calgary"] = "calgary-ab",
            ["edmonton"] = "edmonton-ab",
            ["ottawa"] = "ottawa-on",
            ["winnipeg"] = "winnipeg-mb",
            ["quebec-city"] = "quebec-city-qc",
        };

        // Ensures this metro's directory is present and not stale, (re)crawling
        // CinemaClock's own listing page if needed. Best-effort: any failure
        // (unmapped metro, 404, parse error, geocoding failure) is logged and
        // swallowed — a missing directory just means the caller falls back to
        // the metro-wide scrape-and-fuzzy-match path, not an error.
        public async Task EnsureFreshAsync(AppDbContext db, string metroSlug)
        {
            var staleBefore = DateTime.UtcNow - DirectoryTtl;
            var hasFreshEntry = await db.CinemaClockTheaters
                .AnyAsync(t => t.MetroSlug == metroSlug && t.LastVerifiedAt >= staleBefore);
            if (hasFreshEntry) return;

            if (!DirectorySlugByMetro.TryGetValue(metroSlug, out var pageSlug))
            {
                _logger.LogWarning("No CinemaClock directory page slug mapped for metro {Metro}.", metroSlug);
                return;
            }

            List<(string Name, string Url, string? Address)> rows;
            try
            {
                rows = await FetchDirectoryPageAsync(pageSlug);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to fetch CinemaClock directory for metro {Metro} ({Slug}).", metroSlug, pageSlug);
                return;
            }

            if (rows.Count == 0)
            {
                _logger.LogWarning("CinemaClock directory for metro {Metro} ({Slug}) returned no theaters.", metroSlug, pageSlug);
                return;
            }

            var geocoded = 0;
            foreach (var (name, url, address) in rows)
            {
                double? lat = null, lng = null;
                if (!string.IsNullOrWhiteSpace(address))
                {
                    var coords = await GeocodeAsync(address);
                    lat = coords?.lat;
                    lng = coords?.lng;
                    if (coords != null) geocoded++;
                }

                var existing = await db.CinemaClockTheaters
                    .FirstOrDefaultAsync(t => t.MetroSlug == metroSlug && t.Url == url);

                if (existing == null)
                {
                    db.CinemaClockTheaters.Add(new CinemaClockTheater
                    {
                        MetroSlug = metroSlug,
                        Name = name,
                        Url = url,
                        Address = address,
                        Latitude = lat,
                        Longitude = lng,
                        LastVerifiedAt = DateTime.UtcNow,
                    });
                }
                else
                {
                    existing.Name = name;
                    existing.Address = address;
                    // Don't blank out coordinates we already had just because
                    // this particular refresh's geocode attempt failed.
                    existing.Latitude = lat ?? existing.Latitude;
                    existing.Longitude = lng ?? existing.Longitude;
                    existing.LastVerifiedAt = DateTime.UtcNow;
                }
            }

            await db.SaveChangesAsync();
            _logger.LogInformation(
                "CinemaClock directory refreshed for {Metro}: {Count} theaters, {Geocoded} geocoded.",
                metroSlug, rows.Count, geocoded);
        }

        // Nearest directory entry to the given point, or null if nothing in
        // this metro's directory is within MatchRadiusMeters — returning null
        // rather than the closest-however-far entry means a genuinely
        // uncovered theater falls back to the fuzzy-match path instead of
        // silently being mapped to the wrong building.
        //
        // nameHint (the Google Places name, when available) is used to break
        // ties among MULTIPLE candidates within the radius — confirmed via
        // real-world distance testing that two distinct theaters in the same
        // shopping plaza can be as little as ~80m apart, both comfortably
        // inside a 200m radius. Pure nearest-distance would pick whichever one
        // happens to be a few meters closer, which has no relationship to
        // which one the host actually selected. When two+ candidates are
        // within range, the one whose name is also most similar to what the
        // host picked wins; distance alone only decides when there's no name
        // to compare against.
        public async Task<CinemaClockTheater?> FindNearestAsync(
            AppDbContext db, string metroSlug, double lat, double lng, string? nameHint = null)
        {
            var candidates = await db.CinemaClockTheaters
                .Where(t => t.MetroSlug == metroSlug && t.Latitude != null && t.Longitude != null)
                .ToListAsync();

            var inRange = candidates
                .Select(t => (Theater: t, Distance: HaversineMeters(lat, lng, t.Latitude!.Value, t.Longitude!.Value)))
                .Where(c => c.Distance <= MatchRadiusMeters)
                .ToList();

            if (inRange.Count == 0) return null;
            if (inRange.Count == 1 || string.IsNullOrWhiteSpace(nameHint)) return inRange
                .OrderBy(c => c.Distance)
                .First().Theater;

            return inRange
                .OrderByDescending(c => TheaterNameMatcher.Similarity(nameHint, c.Theater.Name))
                .ThenBy(c => c.Distance)
                .First().Theater;
        }

        private async Task<List<(string Name, string Url, string? Address)>> FetchDirectoryPageAsync(string pageSlug)
        {
            var client = _httpClientFactory.CreateClient();
            var url = $"https://www.cinemaclock.com/{pageSlug}/movie-theaters";
            var html = await client.GetStringAsync(url);

            var doc = new HtmlDocument();
            doc.LoadHtml(html);

            var results = new List<(string, string, string?)>();
            // Confirmed against the live page's real markup (not guessed):
            // each theater is `<a class="cinemaname" href="/movie-theaters/
            // {slug}"><h3>Name</h3><em class="address">Address</em></a>` —
            // name and address are separate child elements of the SAME link,
            // not separate rows. An earlier version of this parser assumed
            // the address lived in a sibling/ancestor element and grabbed the
            // link's raw InnerText for the name, which silently glued the
            // address onto the end of every theater's name — caught by
            // testing against the real fetched page before this ever ran
            // against production data.
            var links = doc.DocumentNode.SelectNodes("//a[contains(@class, 'cinemaname')]");
            if (links == null) return results;

            var seenUrls = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var link in links)
            {
                var href = link.GetAttributeValue("href", "");
                if (string.IsNullOrWhiteSpace(href)) continue;

                var name = System.Net.WebUtility.HtmlDecode(
                    link.SelectSingleNode(".//h3")?.InnerText ?? "").Trim();
                if (string.IsNullOrWhiteSpace(name)) continue;

                var absoluteUrl = href.StartsWith("http", StringComparison.OrdinalIgnoreCase)
                    ? href
                    : $"https://www.cinemaclock.com{(href.StartsWith('/') ? "" : "/")}{href}";

                if (!seenUrls.Add(absoluteUrl)) continue;

                var address = System.Net.WebUtility.HtmlDecode(
                    link.SelectSingleNode(".//em[contains(@class, 'address')]")?.InnerText ?? "").Trim();

                results.Add((name, absoluteUrl, string.IsNullOrWhiteSpace(address) ? null : address));
            }

            return results;
        }

        // Google Geocoding API — reuses the same key already configured for
        // Places (LocationsController), no new vendor or credential.
        private async Task<(double lat, double lng)?> GeocodeAsync(string address)
        {
            var apiKey = _configuration["GooglePlaces:ApiKey"];
            if (string.IsNullOrWhiteSpace(apiKey)) return null;

            try
            {
                var client = _httpClientFactory.CreateClient();
                var url = "https://maps.googleapis.com/maps/api/geocode/json"
                    + $"?address={Uri.EscapeDataString(address)}&key={apiKey}";
                var response = await client.GetAsync(url);
                if (!response.IsSuccessStatusCode) return null;

                var body = await response.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;
                if (!root.TryGetProperty("status", out var status) || status.GetString() != "OK") return null;

                var location = root.GetProperty("results")[0].GetProperty("geometry").GetProperty("location");
                return (location.GetProperty("lat").GetDouble(), location.GetProperty("lng").GetDouble());
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Geocoding failed for address \"{Address}\".", address);
                return null;
            }
        }

        // Great-circle distance between two points, in meters.
        private static double HaversineMeters(double lat1, double lon1, double lat2, double lon2)
        {
            const double earthRadiusMeters = 6371000;
            var dLat = ToRadians(lat2 - lat1);
            var dLon = ToRadians(lon2 - lon1);
            var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
                    + Math.Cos(ToRadians(lat1)) * Math.Cos(ToRadians(lat2))
                    * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
            var c = 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
            return earthRadiusMeters * c;
        }

        private static double ToRadians(double degrees) => degrees * Math.PI / 180;
    }
}
