using Backend.Data;
using Backend.Models;
using Microsoft.EntityFrameworkCore;

namespace Backend.Services
{
    // Runs the nightly showtimes scrape (see ShowtimesScraperService for what
    // and why). OFF unless Showtimes:Enabled=true (env var
    // Showtimes__Enabled on Render) — the deploy that ships this code is
    // inert until the flag is flipped, so it cannot affect the app-store
    // launch build's backend behavior.
    //
    // Schedule: once per calendar day (UTC), at the first poll after 09:00
    // UTC (~4am Central) — after US theaters have posted the next day's
    // times, before anyone's browsing. "Has today's scrape happened" is
    // derived from the newest ScrapedAtUtc in the table rather than in-memory
    // state, so a mid-scrape restart (Render redeploy) just re-runs on the
    // next poll instead of skipping a day.
    public class ShowtimesScrapeBackgroundService : BackgroundService
    {
        private static readonly TimeSpan PollInterval = TimeSpan.FromMinutes(15);
        private const int ScrapeHourUtc = 9;

        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ShowtimesScraperService _scraper;
        private readonly IConfiguration _configuration;
        private readonly ILogger<ShowtimesScrapeBackgroundService> _logger;

        public ShowtimesScrapeBackgroundService(
            IServiceScopeFactory scopeFactory,
            ShowtimesScraperService scraper,
            IConfiguration configuration,
            ILogger<ShowtimesScrapeBackgroundService> logger)
        {
            _scopeFactory = scopeFactory;
            _scraper = scraper;
            _configuration = configuration;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (!_configuration.GetValue<bool>("Showtimes:Enabled"))
            {
                _logger.LogInformation("Showtimes scraping disabled (Showtimes:Enabled is not true).");
                return;
            }

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    if (await IsScrapeDueAsync(stoppingToken))
                    {
                        await RunScrapeAsync(stoppingToken);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Showtimes scrape pass failed.");
                }

                await Task.Delay(PollInterval, stoppingToken);
            }
        }

        // A failed run leaves yesterday's newest ScrapedAtUtc in place, which
        // made "is a scrape due" true again 15 minutes later — on a day the
        // source is blocking us, that's ~5,000 requests hammering a site
        // already saying no. One attempt per 4h is the ceiling regardless of
        // outcome (a success makes the due-check false anyway).
        private DateTime _lastAttemptUtc = DateTime.MinValue;

        private async Task<bool> IsScrapeDueAsync(CancellationToken ct)
        {
            var now = DateTime.UtcNow;
            if (now - _lastAttemptUtc < TimeSpan.FromHours(4)) return false;
            if (now.Hour < ScrapeHourUtc)
            {
                // Before today's scrape window — but if the table is entirely
                // empty (first deploy with the flag on), run immediately so
                // enabling the feature doesn't show an empty screen until 9am
                // UTC tomorrow.
                using var scope = _scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                return !await db.ScrapedShowtimes.AnyAsync(ct);
            }

            using (var scope = _scopeFactory.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var newest = await db.ScrapedShowtimes
                    .OrderByDescending(s => s.ScrapedAtUtc)
                    .Select(s => (DateTime?)s.ScrapedAtUtc)
                    .FirstOrDefaultAsync(ct);
                return newest == null || newest.Value.Date < now.Date;
            }
        }

        public async Task RunScrapeAsync(CancellationToken ct)
        {
            _lastAttemptUtc = DateTime.UtcNow;

            // Comma-separated metro slugs (Cinema Clock URL form, e.g.
            // "dallas-tx,houston-tx"). Growing coverage = editing this env
            // var, no deploy. Legacy single-city key kept as fallback.
            var cities = (_configuration["Showtimes:Cities"] ?? _configuration["Showtimes:City"] ?? "dallas-tx")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            var maxTheaters = _configuration.GetValue("Showtimes:MaxTheaters", 80);
            var today = CentralTime.Today; // theater-local "today"

            var slugs = new List<string>();
            foreach (var city in cities)
            {
                try
                {
                    var citySlugs = await _scraper.FetchTheaterSlugsAsync(city, maxTheaters, ct);
                    _logger.LogInformation("Showtimes: {City} has {Count} theaters.", city, citySlugs.Count);
                    slugs.AddRange(citySlugs);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // A bad/unknown city slug shouldn't sink the other metros.
                    _logger.LogWarning(ex, "Showtimes: directory fetch failed for {City}.", city);
                }
                await _scraper.DelayBetweenRequestsAsync(ct);
            }
            slugs = slugs.Distinct().ToList();

            if (slugs.Count == 0 && cities.Length > 0)
            {
                // Every metro directory failed — that's a block or a redesign,
                // not flaky pages, and it must reach Sentry as an error.
                _logger.LogError(
                    "Showtimes: directory returned no theaters for ANY of {Count} cities — likely blocked or redesigned.",
                    cities.Length);
            }

            // Captured before any theater is written this run, so every theater
            // refreshed below gets a ScrapedAtUtc >= this. Anything still older
            // afterwards is a theater this run didn't touch — purged at the end.
            var scrapeStart = DateTime.UtcNow;

            var succeeded = 0;
            var failed = 0;
            var failedSlugs = new List<string>();

            foreach (var slug in slugs)
            {
                await _scraper.DelayBetweenRequestsAsync(ct);
                try
                {
                    var theater = await _scraper.FetchTheaterAsync(slug, today, ct);
                    if (theater == null)
                    {
                        // Page fetched but didn't parse — the signal that the
                        // site's structure changed. Counted and logged loudly
                        // below rather than silently producing empty data.
                        failed++;
                        failedSlugs.Add(slug);
                        _logger.LogWarning("Showtimes page for {Slug} did not parse.", slug);
                        continue;
                    }
                    if (theater.Showings.Count == 0)
                    {
                        // Identity parsed but ZERO showings: for an open
                        // theater that's the times-markup-changed shape, and
                        // writing it would wipe the theater's cache while the
                        // run reports success. Keep yesterday's rows instead.
                        failed++;
                        failedSlugs.Add(slug);
                        _logger.LogWarning("Showtimes page for {Slug} parsed but held 0 showings — keeping previous rows.", slug);
                        continue;
                    }

                    await ReplaceTheaterRowsAsync(theater, ct);
                    succeeded++;
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    failed++;
                    failedSlugs.Add(slug);
                    _logger.LogWarning(ex, "Showtimes scrape failed for {Slug}.", slug);
                }
            }

            // Every theater failing is a different situation than a few flaky
            // pages — that's "the parser is broken," and it should be an error
            // in Sentry, not a scroll of warnings.
            if (succeeded == 0 && slugs.Count > 0)
            {
                _logger.LogError(
                    "Showtimes scrape parsed 0 of {Count} theaters — site structure likely changed.",
                    slugs.Count);
            }
            else
            {
                _logger.LogInformation(
                    "Showtimes scrape finished: {Ok} theaters updated, {Failed} failed.",
                    succeeded, failed);
            }

            // Purge theaters this run didn't refresh. Without this, rows from
            // earlier scrapes pile up — the directory rotates which theaters it
            // returns, and nightly + manual runs stack — until each showing ages
            // out ~a week later, leaving hundreds of stale theaters in the list.
            // Only after a run that actually produced data, so a fully-failed
            // scrape can't wipe the whole cache.
            if (succeeded > 0)
            {
                using var scope = _scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                // Failed slugs keep their previous rows — the purge exists to
                // drop theaters that VANISHED from the directory, not ones we
                // merely couldn't refresh today.
                var removed = await db.ScrapedShowtimes
                    .Where(s => s.ScrapedAtUtc < scrapeStart && !failedSlugs.Contains(s.TheaterSlug))
                    .ExecuteDeleteAsync(ct);
                if (removed > 0)
                    _logger.LogInformation("Showtimes: purged {Count} stale rows from earlier scrapes.", removed);
            }
        }

        // Swap one theater's rows atomically-enough: readers between the
        // delete and insert of a single theater see it briefly empty, which
        // for a 4am job on a browse feature is acceptable; per-theater
        // batching keeps any failure from wiping other theaters' data.
        private async Task ReplaceTheaterRowsAsync(ShowtimesScraperService.TheaterShowtimes theater, CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var old = await db.ScrapedShowtimes
                .Where(s => s.TheaterSlug == theater.TheaterSlug)
                .ToListAsync(ct);
            db.ScrapedShowtimes.RemoveRange(old);

            var now = DateTime.UtcNow;
            foreach (var s in theater.Showings)
            {
                db.ScrapedShowtimes.Add(new ScrapedShowtime
                {
                    TheaterSlug = theater.TheaterSlug,
                    TheaterName = theater.TheaterName,
                    Latitude = theater.Latitude,
                    Longitude = theater.Longitude,
                    MovieTitle = s.MovieTitle.Length <= 250 ? s.MovieTitle : s.MovieTitle[..250],
                    MovieSlug = s.MovieSlug.Length <= 250 ? s.MovieSlug : s.MovieSlug[..250],
                    ShowDate = s.ShowDate,
                    StartMinutes = s.StartMinutes,
                    ScrapedAtUtc = now,
                });
            }

            await db.SaveChangesAsync(ct);
        }
    }
}
