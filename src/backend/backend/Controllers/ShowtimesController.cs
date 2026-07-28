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

        public ShowtimesController(AppDbContext db, ShowtimeRefreshService refresh)
        {
            _db = db;
            _refresh = refresh;
        }

        [HttpGet]
        public async Task<IActionResult> GetShowtimes(
            [FromQuery] string? movieTitle,
            [FromQuery] string? theaterName,
            [FromQuery] string? date,
            [FromQuery] string? city,
            [FromQuery] string? state)
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

            var movie = await ResolveMovieAsync(movieTitle);
            if (movie == null)
            {
                return Ok(new
                {
                    movie = (object?)null,
                    metroSlug,
                    isRefreshing,
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
            if (metroSlug != null)
            {
                query = query.Where(s => s.City != null && s.City.ToLower() == metroSlug.ToLower());
            }

            var candidates = (await query.OrderBy(s => s.StartsAt).ToListAsync())
                .Where(IsUpcoming)
                .ToList();

            // Theater matching runs in memory: the two sources name the same
            // building differently, so this can't be a SQL equality filter.
            if (!string.IsNullOrWhiteSpace(theaterName))
            {
                var distinctTheaters = candidates
                    .Select(s => s.TheaterName)
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
                    .Where(s => string.Equals(s.TheaterName, matched, StringComparison.OrdinalIgnoreCase))
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
                matchedTheaterName = candidates.FirstOrDefault()?.TheaterName,
                showtimes = candidates.Select(s => new
                {
                    id = s.Id,
                    theaterName = s.TheaterName,
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
