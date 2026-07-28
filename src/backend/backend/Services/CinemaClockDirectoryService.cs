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
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<CinemaClockDirectoryService> _logger;

        // Static data, not showtimes — theaters don't open/close/rebrand
        // often, so this is refreshed on a much longer cycle than the 48h
        // showtime TTL.
        public static readonly TimeSpan DirectoryTtl = TimeSpan.FromDays(30);

        // How long to wait before retrying a metro whose crawl produced no
        // usable (geocoded) rows. Without this, a persistently failing
        // geocode would re-crawl on every single request.
        private static readonly TimeSpan FailedRetryDelay = TimeSpan.FromMinutes(15);

        // A theater within this radius of the Google Places pick is treated
        // as the same physical building. Tight enough that two distinct
        // theaters in the same shopping center shouldn't collide, loose
        // enough to absorb small geocoding error between Google's and our
        // own geocoded coordinates for the same address.
        private const double MatchRadiusMeters = 200;

        // In-process guard so concurrent requests for the same uncrawled
        // metro don't each start their own crawl (each of which would fire a
        // billable geocode per theater). Single Render instance, so in-memory
        // is sufficient; the DB-level TTL is the durable backstop.
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, DateTime> LastAttemptByMetro = new();
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, byte> InFlight = new();

        public CinemaClockDirectoryService(
            IHttpClientFactory httpClientFactory,
            IConfiguration configuration,
            IServiceScopeFactory scopeFactory,
            ILogger<CinemaClockDirectoryService> logger)
        {
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _scopeFactory = scopeFactory;
            _logger = logger;
        }

        // Is this metro's directory actually USABLE right now?
        //
        // Deliberately requires at least one row WITH coordinates, not merely
        // a recent LastVerifiedAt. A crawl that stored 81 theaters but
        // geocoded none of them is worthless for geo-matching, and treating
        // it as "fresh" would lock that dead state in for the full 30-day TTL
        // — which is exactly the failure mode that made this feature look
        // built-but-broken.
        public Task<bool> IsUsableAsync(AppDbContext db, string metroSlug)
        {
            var staleBefore = DateTime.UtcNow - DirectoryTtl;
            return db.CinemaClockTheaters.AnyAsync(t =>
                t.MetroSlug == metroSlug
                && t.Latitude != null
                && t.Longitude != null
                && t.LastVerifiedAt >= staleBefore);
        }

        // Kicks off a directory crawl in the BACKGROUND if this metro needs
        // one. Returns immediately — never blocks the caller.
        //
        // The crawl is one HTTP fetch plus a geocode per theater (81 for
        // Dallas). Awaiting that inside a request took ~30s end to end, which
        // is well past any reasonable client timeout. The first caller for a
        // new metro therefore falls back to fuzzy matching and the directory
        // is ready for subsequent callers — the same lazy pattern used for
        // showtime scrapes.
        public void RequestRefresh(string metroSlug)
        {
            if (LastAttemptByMetro.TryGetValue(metroSlug, out var lastAttempt)
                && DateTime.UtcNow - lastAttempt < FailedRetryDelay)
            {
                return;
            }

            if (!InFlight.TryAdd(metroSlug, 0)) return; // already crawling
            LastAttemptByMetro[metroSlug] = DateTime.UtcNow;

            _ = Task.Run(async () =>
            {
                try
                {
                    // Own scope: this outlives the request, and AppDbContext
                    // is scoped (and not thread-safe), so reusing the
                    // request's context here would be a use-after-dispose.
                    using var scope = _scopeFactory.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                    await EnsureFreshAsync(db, metroSlug);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Background directory refresh for {Metro} failed.", metroSlug);
                }
                finally
                {
                    InFlight.TryRemove(metroSlug, out _);
                }
            });
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
            if (await IsUsableAsync(db, metroSlug)) return;

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

            // Load this metro's existing rows ONCE. Querying per theater was
            // an N+1 — 81 round trips for Dallas alone, on top of the
            // geocoding below.
            var existingByUrl = (await db.CinemaClockTheaters
                    .Where(t => t.MetroSlug == metroSlug)
                    .ToListAsync())
                .GroupBy(t => t.Url, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

            var geocoded = 0;
            var geocodeFailures = 0;
            foreach (var (name, url, address) in rows)
            {
                double? lat = null, lng = null;
                // Skip the geocode entirely when we already have coordinates
                // for this theater — addresses effectively never change, and
                // this is a billable Google call per theater per refresh.
                existingByUrl.TryGetValue(url, out var existing);
                var alreadyHasCoords = existing?.Latitude != null && existing.Longitude != null;

                if (!alreadyHasCoords && !string.IsNullOrWhiteSpace(address))
                {
                    var coords = await GeocodeAsync(address);
                    lat = coords?.lat;
                    lng = coords?.lng;
                    if (coords != null) geocoded++; else geocodeFailures++;
                }

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

            var usableRows = await db.CinemaClockTheaters
                .CountAsync(t => t.MetroSlug == metroSlug && t.Latitude != null && t.Longitude != null);

            if (usableRows == 0)
            {
                // Rows were stored (names/URLs are still useful for the
                // per-theater scrape), but with no coordinates the geo-match
                // can't run at all. Logged as an error because it's silent
                // from the outside — geo matching just quietly never fires.
                _logger.LogError(
                    "CinemaClock directory for {Metro}: stored {Count} theaters but geocoded NONE "
                    + "({Failures} geocode failures). Geo-matching is disabled for this metro — check that "
                    + "the Geocoding API is enabled on GooglePlaces:ApiKey (it is a separate API from Places).",
                    metroSlug, rows.Count, geocodeFailures);
                return;
            }

            _logger.LogInformation(
                "CinemaClock directory refreshed for {Metro}: {Count} theaters, {Geocoded} newly geocoded, "
                + "{Failures} failures, {Usable} usable for geo-matching.",
                metroSlug, rows.Count, geocoded, geocodeFailures, usableRows);
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

        // Diagnostic: the nearest N directory entries to a point with their
        // actual distances, regardless of match radius. Answers "why didn't
        // my theater match?" — which is otherwise invisible, since a failed
        // geo-match is indistinguishable from having no data at all.
        public async Task<List<(CinemaClockTheater Theater, double DistanceMeters)>> NearestWithDistancesAsync(
            AppDbContext db, string metroSlug, double lat, double lng, int take = 5)
        {
            var candidates = await db.CinemaClockTheaters
                .Where(t => t.MetroSlug == metroSlug && t.Latitude != null && t.Longitude != null)
                .ToListAsync();

            return candidates
                .Select(t => (Theater: t, DistanceMeters: HaversineMeters(lat, lng, t.Latitude!.Value, t.Longitude!.Value)))
                .OrderBy(c => c.DistanceMeters)
                .Take(take)
                .ToList();
        }

        public static double MatchRadius => MatchRadiusMeters;

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
                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError("Geocoding HTTP {Status} for \"{Address}\".", response.StatusCode, address);
                    return null;
                }

                var body = await response.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;
                var statusText = root.TryGetProperty("status", out var status) ? status.GetString() : null;
                if (statusText != "OK")
                {
                    // Logged loudly, not swallowed. This failing silently is
                    // what made the whole geo-match feature look "built but
                    // dead": every theater stored with null coordinates, so
                    // FindNearestAsync had zero candidates and always fell
                    // back to fuzzy matching, with nothing in the logs.
                    //
                    // REQUEST_DENIED here almost always means the Geocoding
                    // API isn't enabled on the key — it's a SEPARATE API from
                    // Places in Google Cloud, and a Places-only key is
                    // rejected. ZERO_RESULTS means the address genuinely
                    // didn't resolve.
                    var errorMessage = root.TryGetProperty("error_message", out var em) ? em.GetString() : null;
                    _logger.LogError(
                        "Geocoding returned {Status} for \"{Address}\"{Detail}",
                        statusText, address,
                        string.IsNullOrWhiteSpace(errorMessage) ? "" : $" — {errorMessage}");
                    return null;
                }

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
