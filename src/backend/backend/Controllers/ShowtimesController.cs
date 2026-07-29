using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Backend.Data;
using Backend.Services;

namespace Backend.Controllers
{
    // Read path for the showtimes ingested nightly by ApifyWebhookController.
    // Powers the native showtime picker in create-space, replacing the old
    // "open a Google search and read the time off it" redirect.
    //
    // AllowAnonymous to match MoviesController — this is public catalog data
    // with no per-user component, and the create-space screen already queries
    // movie metadata unauthenticated.
    [ApiController]
    [Route("api/[controller]")]
    [AllowAnonymous]
    public class ShowtimesController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly ShowtimeRefreshService _refresh;
        private readonly CinemaClockDirectoryService _directory;
        private readonly ILogger<ShowtimesController> _logger;

        public ShowtimesController(
            AppDbContext db,
            ShowtimeRefreshService refresh,
            CinemaClockDirectoryService directory,
            ILogger<ShowtimesController> logger)
        {
            _db = db;
            _refresh = refresh;
            _directory = directory;
            _logger = logger;
        }

        [HttpGet]
        public async Task<IActionResult> GetShowtimes(
            [FromQuery] string? movieTitle,
            [FromQuery] string? theaterName,
            [FromQuery] string? date,
            [FromQuery] string? city,
            [FromQuery] string? state,
            [FromQuery] double? theaterLat,
            [FromQuery] double? theaterLng)
        {
            if (string.IsNullOrWhiteSpace(movieTitle))
            {
                return BadRequest(new { error = "movieTitle is required." });
            }

            // Lazy ingest: if the caller's metro has gone stale (or was never
            // scraped), kick off a refresh for just that metro. This runs
            // before the query so a first-time user starts the scrape that
            // will serve them on their next attempt.
            var metroSlug = MetroAreas.Resolve(city, state);
            var isRefreshing = false;
            if (metroSlug != null && await _refresh.TryClaimRefreshAsync(_db, metroSlug))
            {
                // Not awaited: an Apify run takes far longer than a request
                // should, and the webhook ingests the result independently.
                _ = _refresh.TriggerScrapeAsync(metroSlug);
                isRefreshing = true;
            }

            // Resolve the picked theater against the directory BEFORE the
            // movie lookup, because triggering a per-theater scrape doesn't
            // depend on the movie — and gating it behind a known movie
            // creates a chicken-and-egg deadlock: a theater we've never
            // scraped only has movies we've never seen, so the movie lookup
            // fails, we return early, and the scrape that would have taught
            // us those movies never fires. That theater then stays
            // permanently unscraped no matter how many times it's picked.
            string? exactTheaterMatch = null;
            if (metroSlug != null && theaterLat.HasValue && theaterLng.HasValue)
            {
                try
                {
                    // Non-blocking: a first-time crawl is one page fetch plus
                    // a geocode per theater (~30s for Dallas's 81), far too
                    // slow to await inside a request. This caller falls back
                    // to fuzzy matching and the directory serves the next one.
                    if (!await _directory.IsUsableAsync(_db, metroSlug))
                    {
                        _directory.RequestRefresh(metroSlug);
                    }

                    var directoryMatch = await _directory.FindNearestAsync(_db, metroSlug, theaterLat.Value, theaterLng.Value, theaterName);
                    if (directoryMatch != null)
                    {
                        exactTheaterMatch = directoryMatch.Name;
                        if (await _refresh.TryClaimTheaterRefreshAsync(_db, directoryMatch.Id))
                        {
                            _ = _refresh.TriggerTheaterScrapeAsync(directoryMatch.Url);
                            isRefreshing = true;
                        }
                    }
                }
                catch (Exception ex)
                {
                    // Directory lookup is a precision improvement, not a
                    // requirement — any failure here just means the fuzzy
                    // path below runs exactly as it always has.
                    _logger.LogWarning(ex, "CinemaClock directory lookup failed for metro {Metro}.", metroSlug);
                }
            }

            var movie = await ResolveMovieAsync(movieTitle);
            if (movie == null)
            {
                return Ok(new
                {
                    movie = (object?)null,
                    metroSlug,
                    // isRefreshing may now be true here: we don't know this
                    // movie yet, but a scrape for the picked theater is
                    // underway and may well introduce it.
                    isRefreshing,
                    matchedTheaterName = exactTheaterMatch,
                    showtimes = Array.Empty<object>(),
                });
            }

            // Coarse SQL prefilter only. Rows in one response can span cities
            // in different timezones, so the real "has this passed?" test is
            // per-row (IsUpcoming) once the rows are in memory — this just
            // prunes obviously-dead rows cheaply, wide enough to be safe for
            // any timezone on earth.
            var coarseLowerBound = DateTime.SpecifyKind(DateTime.UtcNow.AddHours(-24), DateTimeKind.Unspecified);

            var query = _db.Showtimes
                .Where(s => s.MovieId == movie.Id && s.StartsAt >= coarseLowerBound);

            // Scope by METRO, not by the raw city string. Rows are stored
            // under the metro slug the scraper ran for ("dallas"), while the
            // caller reports wherever they actually are ("Frisco") — filtering
            // on the raw city would exclude every suburb, which is the whole
            // problem metro mapping exists to solve. An unmapped caller isn't
            // filtered at all rather than being filtered to nothing.
            //
            // A row with City == null is NOT excluded here — confirmed live
            // that getTheaterShowtimes results carry no city field at all, so
            // ingest backfills it from the theater directory when it can, but
            // a row can still land without one (theater not yet directoried).
            // Excluding those would silently hide a real, successfully
            // scraped showtime. The subsequent theater-name match (exact
            // directory match or fuzzy) still scopes correctly to one
            // physical theater regardless of whether City is populated.
            if (metroSlug != null)
            {
                query = query.Where(s => s.City == null || s.City.ToLower() == metroSlug.ToLower());
            }

            var candidates = (await query.OrderBy(s => s.StartsAt).ToListAsync())
                .Where(IsUpcoming)
                .ToList();

            // Theater matching runs in memory: the two sources name the same
            // building differently, so this can't be a SQL equality filter.
            // exactTheaterMatch was resolved above, before the movie lookup.
            if (exactTheaterMatch != null)
            {
                // Compared via ScrapedText, not raw equality — rows scraped
                // before the ingest-side decode fix still carry malformed
                // entities ("Dine&#8209In") that plain HtmlDecode can't
                // repair, so a byte comparison against the directory's clean
                // Name fails. Normalizing both sides lets already-stored data
                // self-heal immediately rather than staying invisible until a
                // fresh scrape overwrites it — same reasoning as the
                // City IS NULL leniency above.
                candidates = candidates
                    .Where(s => ScrapedText.SameTheater(s.TheaterName, exactTheaterMatch))
                    .ToList();
            }
            else if (!string.IsNullOrWhiteSpace(theaterName))
            {
                // Decoded before scoring — a raw "&#8209;" survives
                // TheaterNameMatcher's normalization as the literal digits
                // "8209" (non-alphanumeric characters are stripped, but
                // digits aren't), which is pure noise polluting the
                // similarity score. Harmless when it doesn't change the
                // winner, real risk when it's the difference between two
                // close candidates.
                var distinctTheaters = candidates
                    .Select(s => ScrapedText.Decode(s.TheaterName))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                var matched = TheaterNameMatcher.BestMatch(theaterName, distinctTheaters);
                if (matched == null)
                {
                    return Ok(new
                    {
                        movie = Project(movie),
                        metroSlug,
                        isRefreshing,
                        matchedTheaterName = (string?)null,
                        showtimes = Array.Empty<object>(),
                    });
                }

                candidates = candidates
                    .Where(s => ScrapedText.SameTheater(s.TheaterName, matched))
                    .ToList();
            }

            if (!string.IsNullOrWhiteSpace(date) && DateTime.TryParse(date, out var onDate))
            {
                candidates = candidates.Where(s => s.StartsAt.Date == onDate.Date).ToList();
            }

            return Ok(new
            {
                movie = Project(movie),
                metroSlug,
                isRefreshing,
                // Decoded for the client too — old rows scraped before the
                // ingest-side fix can still carry raw entities in the DB.
                matchedTheaterName = candidates.FirstOrDefault() is { } first
                    ? ScrapedText.Decode(first.TheaterName)
                    : null,
                showtimes = candidates.Select(s => new
                {
                    id = s.Id,
                    theaterName = ScrapedText.Decode(s.TheaterName),
                    city = s.City,
                    // ISO-ish local wall clock, NO trailing Z — the client must
                    // not reinterpret this as UTC.
                    startsAt = s.StartsAt.ToString("yyyy-MM-dd'T'HH:mm:ss"),
                    date = s.StartsAt.ToString("yyyy-MM-dd"),
                    time = s.StartsAt.ToString("h:mm tt", System.Globalization.CultureInfo.InvariantCulture),
                    format = s.Format,
                    bookingLink = s.BookingLink,
                }),
            });
        }

        // Operational visibility into the ingest pipeline, which is otherwise
        // completely opaque — there's no other way to tell "no showtimes"
        // (nothing scraped yet) apart from "geo-matching is silently broken"
        // (theaters stored but none geocoded) apart from "this movie just
        // isn't playing there". Aggregate counts only: no keys, no URLs, no
        // user data, so this is safe to leave unauthenticated alongside the
        // public catalog data this controller already serves.
        // Companion to /diagnostics: given the coordinates the app would send
        // for a picked theater, show the nearest directory entries and their
        // actual distances. A geo-match failure is otherwise silent and
        // indistinguishable from "no data", so this is the only way to tell
        // "the theater isn't in the directory" from "it's there but the two
        // geocoders disagree by more than the match radius".
        [HttpGet("diagnostics/nearest")]
        public async Task<IActionResult> GetNearest(
            [FromQuery] double lat,
            [FromQuery] double lng,
            [FromQuery] string? city,
            [FromQuery] string? state)
        {
            var metroSlug = MetroAreas.Resolve(city, state);
            if (metroSlug == null)
            {
                return Ok(new { metroSlug = (string?)null, error = "City/state did not resolve to a supported metro." });
            }

            var nearest = await _directory.NearestWithDistancesAsync(_db, metroSlug, lat, lng);
            return Ok(new
            {
                metroSlug,
                closeRadiusMeters = CinemaClockDirectoryService.CloseRadius,
                wideRadiusMeters = CinemaClockDirectoryService.WideRadius,
                nearest = nearest.Select(n => new
                {
                    name = n.Theater.Name,
                    address = n.Theater.Address,
                    latitude = n.Theater.Latitude,
                    longitude = n.Theater.Longitude,
                    distanceMeters = Math.Round(n.DistanceMeters),
                    // Close = matched on distance alone; wide = matched only
                    // if the name also corroborates it.
                    withinCloseRadius = n.DistanceMeters <= CinemaClockDirectoryService.CloseRadius,
                    withinWideRadius = n.DistanceMeters <= CinemaClockDirectoryService.WideRadius,
                }),
            });
        }

        [HttpGet("diagnostics")]
        public async Task<IActionResult> GetDiagnostics()
        {
            var theatersByMetro = await _db.CinemaClockTheaters
                .GroupBy(t => t.MetroSlug)
                .Select(g => new
                {
                    metro = g.Key,
                    theaters = g.Count(),
                    geocoded = g.Count(t => t.Latitude != null && t.Longitude != null),
                    lastVerified = g.Max(t => t.LastVerifiedAt),
                })
                .ToListAsync();

            var showtimesByCity = await _db.Showtimes
                .GroupBy(s => s.City)
                .Select(g => new
                {
                    city = g.Key ?? "(null)",
                    showtimes = g.Count(),
                    theaters = g.Select(s => s.TheaterName).Distinct().Count(),
                })
                .ToListAsync();

            var metroLogs = await _db.MetroScrapeLogs
                .Select(l => new { l.MetroSlug, l.Status, l.LastScrapedAt, l.LastRowCount })
                .ToListAsync();

            var theaterLogs = await _db.TheaterScrapeLogs.CountAsync();

            return Ok(new
            {
                movies = await _db.NowPlayingMovies.CountAsync(),
                totalShowtimes = await _db.Showtimes.CountAsync(),
                // geocoded == 0 while theaters > 0 is the specific signature
                // of the Geocoding API not being enabled on the key.
                directory = theatersByMetro,
                showtimesByCity,
                metroScrapeLogs = metroLogs,
                theaterScrapeLogCount = theaterLogs,
            });
        }

        // Has this screening already happened?
        //
        // A scraped showtime is a bare wall-clock reading with no offset, so
        // it can't be compared to UTC directly. Instead we translate "now"
        // into the theater city's own wall clock and compare like with like —
        // which also gets DST right, since TimeZoneInfo resolves the offset
        // for that specific date.
        //
        // The 30-minute grace keeps a screening that just started selectable
        // (a host mid-booking shouldn't watch the slot vanish), without
        // leaving hours of dead showtimes on screen the way the old
        // timezone-blind window did.
        private static bool IsUpcoming(Models.Showtime showtime)
        {
            // Rows store the metro slug they were scraped under ("dallas",
            // "los-angeles"), so resolve that first; CityTimeZones covers
            // plain city names for anything not stored as a slug.
            var zone = MetroAreas.TimeZoneFor(showtime.City);
            var nowLocal = zone != null
                ? DateTime.SpecifyKind(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone), DateTimeKind.Unspecified)
                : CityTimeZones.NowInCity(showtime.City);

            if (nowLocal == null)
            {
                // City isn't mapped, so we genuinely don't know the offset.
                // Stay lenient rather than risk hiding tonight's real
                // showtimes — same behavior as before timezone support.
                var fallback = DateTime.SpecifyKind(DateTime.UtcNow.AddHours(-12), DateTimeKind.Unspecified);
                return showtime.StartsAt >= fallback;
            }

            return showtime.StartsAt >= nowLocal.Value.AddMinutes(-30);
        }

        // The scraped title and the OMDb-backed title the user picked in the
        // app rarely match byte-for-byte ("Evil Dead Burn" vs "Evil Dead:
        // Burn"), so fall back to the same normalize-then-fuzzy approach used
        // for theater names.
        private async Task<Models.NowPlayingMovie?> ResolveMovieAsync(string movieTitle)
        {
            var exact = await _db.NowPlayingMovies
                .FirstOrDefaultAsync(m => m.Title.ToLower() == movieTitle.ToLower());
            if (exact != null) return exact;

            var all = await _db.NowPlayingMovies.ToListAsync();
            var best = TheaterNameMatcher.BestMatch(movieTitle, all.Select(m => m.Title), threshold: 0.85);
            return best == null
                ? null
                : all.FirstOrDefault(m => string.Equals(m.Title, best, StringComparison.OrdinalIgnoreCase));
        }

        private static object Project(Models.NowPlayingMovie m) => new
        {
            id = m.Id,
            title = m.Title,
            imdbId = m.ImdbId,
            overview = m.Overview,
            posterUrl = m.PosterUrl,
            voteAverage = m.VoteAverage,
            releaseYear = m.ReleaseDate?.Year,
        };
    }
}
