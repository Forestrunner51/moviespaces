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

        public ShowtimesController(AppDbContext db)
        {
            _db = db;
        }

        [HttpGet]
        public async Task<IActionResult> GetShowtimes(
            [FromQuery] string? movieTitle,
            [FromQuery] string? theaterName,
            [FromQuery] string? date,
            [FromQuery] string? city)
        {
            if (string.IsNullOrWhiteSpace(movieTitle))
            {
                return BadRequest(new { error = "movieTitle is required." });
            }

            var movie = await ResolveMovieAsync(movieTitle);
            if (movie == null)
            {
                return Ok(new { movie = (object?)null, showtimes = Array.Empty<object>() });
            }

            // StartsAt is local wall-clock with no known offset (see the
            // Showtime model), so "upcoming" is deliberately generous rather
            // than a precise instant comparison — better to show a slot that
            // just started than to hide tonight's real screenings for anyone
            // whose timezone we guessed wrong.
            var lowerBound = DateTime.SpecifyKind(DateTime.UtcNow.AddHours(-12), DateTimeKind.Unspecified);

            var query = _db.Showtimes
                .Where(s => s.MovieId == movie.Id && s.StartsAt >= lowerBound);

            if (!string.IsNullOrWhiteSpace(city))
            {
                query = query.Where(s => s.City != null && s.City.ToLower() == city.ToLower());
            }

            var candidates = await query
                .OrderBy(s => s.StartsAt)
                .ToListAsync();

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
