using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Backend.Data;
using Backend.Models;

namespace Backend.Services
{
    // On-demand ("lazy") showtime refresh: when someone asks for showtimes in
    // a metro whose data has gone stale, kick off an Apify run for just that
    // metro instead of scraping every city nightly.
    //
    // The expensive failure mode this is built to avoid is a stampede: N
    // simultaneous requests for the same stale metro each triggering their own
    // billable run. Claiming is therefore a single atomic conditional UPDATE —
    // whoever flips LastScrapedAt wins, everyone else sees a fresh row and
    // triggers nothing.
    public class ShowtimeRefreshService
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly ILogger<ShowtimeRefreshService> _logger;

        // Data is considered fresh for this long. Showtimes for the next few
        // days barely move, so refreshing more often just burns Apify credit.
        public static readonly TimeSpan CacheTtl = TimeSpan.FromHours(48);

        private const string ActorId = "botdGp1cE6tb5ixlO";

        public ShowtimeRefreshService(
            IHttpClientFactory httpClientFactory,
            IConfiguration configuration,
            ILogger<ShowtimeRefreshService> logger)
        {
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _logger = logger;
        }

        // True when this caller won the race and should trigger a scrape.
        //
        // Both branches below are atomic against concurrent callers:
        //  - ExecuteUpdateAsync with the staleness predicate is a single
        //    UPDATE ... WHERE, so exactly one request can flip a stale row.
        //  - the INSERT for a never-seen metro is guarded by the primary key,
        //    so a duplicate-key violation means someone else just claimed it.
        public async Task<bool> TryClaimRefreshAsync(AppDbContext db, string metroSlug)
        {
            var staleBefore = DateTime.UtcNow - CacheTtl;

            var claimed = await db.MetroScrapeLogs
                .Where(l => l.MetroSlug == metroSlug && l.LastScrapedAt < staleBefore)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(l => l.LastScrapedAt, DateTime.UtcNow)
                    .SetProperty(l => l.Status, "refreshing"));

            if (claimed > 0) return true;

            // Row exists and is still fresh — nothing to do.
            if (await db.MetroScrapeLogs.AnyAsync(l => l.MetroSlug == metroSlug)) return false;

            try
            {
                db.MetroScrapeLogs.Add(new MetroScrapeLog
                {
                    MetroSlug = metroSlug,
                    LastScrapedAt = DateTime.UtcNow,
                    Status = "refreshing",
                });
                await db.SaveChangesAsync();
                return true;
            }
            catch (DbUpdateException)
            {
                // Lost the insert race; the winner is already scraping.
                db.ChangeTracker.Clear();
                return false;
            }
        }

        // Fire-and-forget Apify run. Failures are logged, never surfaced —
        // the caller still serves whatever showtimes are already cached, and
        // the client falls back to the Google link if there are none.
        public async Task TriggerScrapeAsync(string metroSlug)
        {
            var token = _configuration["Apify:ApiToken"];
            if (string.IsNullOrWhiteSpace(token))
            {
                _logger.LogError("Cannot trigger scrape for {Metro}: Apify:ApiToken is not configured.", metroSlug);
                return;
            }

            // Actor input. The webhook configured in the Apify console fires
            // on completion and ingests the resulting dataset, so nothing here
            // needs to wait for or poll the run.
            var input = new { mode = "getCityShowtimes", city = metroSlug };

            var url = $"https://api.apify.com/v2/acts/{ActorId}/runs?token={Uri.EscapeDataString(token)}";
            try
            {
                var client = _httpClientFactory.CreateClient();
                var response = await client.PostAsync(url,
                    new StringContent(JsonSerializer.Serialize(input), Encoding.UTF8, "application/json"));

                if (!response.IsSuccessStatusCode)
                {
                    var body = await response.Content.ReadAsStringAsync();
                    _logger.LogError("Apify run for {Metro} failed: {Status} {Body}",
                        metroSlug, response.StatusCode, body);
                    return;
                }

                _logger.LogInformation("Triggered Apify scrape for metro {Metro}.", metroSlug);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Apify run for {Metro} threw.", metroSlug);
            }
        }

        // Called by the webhook once rows land, so the TTL window starts from
        // real data rather than from when the run was merely requested.
        public static async Task MarkScrapedAsync(AppDbContext db, string metroSlug, int rowCount)
        {
            var existing = await db.MetroScrapeLogs.FirstOrDefaultAsync(l => l.MetroSlug == metroSlug);
            if (existing == null)
            {
                db.MetroScrapeLogs.Add(new MetroScrapeLog
                {
                    MetroSlug = metroSlug,
                    LastScrapedAt = DateTime.UtcNow,
                    Status = "ok",
                    LastRowCount = rowCount,
                });
            }
            else
            {
                existing.LastScrapedAt = DateTime.UtcNow;
                existing.Status = "ok";
                existing.LastRowCount = rowCount;
            }
            await db.SaveChangesAsync();
        }
    }
}
