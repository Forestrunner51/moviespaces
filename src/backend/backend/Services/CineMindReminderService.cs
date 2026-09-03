using Microsoft.EntityFrameworkCore;
using Backend.Data;
using Backend.Models;

namespace Backend.Services
{
    // Sends the once-a-day "your puzzle is ready" push — the retention loop
    // every daily-puzzle game runs on.
    //
    // Only people who have ALREADY played at least once get reminded. The push
    // token table covers the whole app, so reminding everyone would push a
    // game to users who've never opened it — the fastest way to get
    // notifications disabled outright.
    public class CineMindReminderService : BackgroundService
    {
        // Checked often enough that the send hour is never skipped, even if a
        // pass is slow or the process restarts mid-window.
        private static readonly TimeSpan PollInterval = TimeSpan.FromMinutes(10);

        private readonly IServiceScopeFactory _scopeFactory;
        private readonly PushNotificationService _push;
        private readonly IConfiguration _configuration;
        private readonly ILogger<CineMindReminderService> _logger;

        public CineMindReminderService(
            IServiceScopeFactory scopeFactory,
            PushNotificationService push,
            IConfiguration configuration,
            ILogger<CineMindReminderService> logger)
        {
            _scopeFactory = scopeFactory;
            _push = push;
            _configuration = configuration;
            _logger = logger;
        }

        // Default 17:00 UTC ≈ noon Central / 1pm Eastern / 10am Pacific.
        //
        // This is deliberately NOT near the puzzle rollover. The puzzle day is
        // UTC, so it flips at 00:00 UTC — 7pm the previous evening in Central.
        // Reminding late in the UTC day would reach a US player with only an
        // hour or two left to play before their streak resets. Midday UTC
        // lands mid-day in the US with hours of runway.
        private int ReminderHourUtc =>
            int.TryParse(_configuration["CineMind:ReminderHourUtc"], out var hour) && hour is >= 0 and <= 23
                ? hour
                : 17;

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await SendIfDueAsync(stoppingToken);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "CineMind reminder pass failed.");
                }

                await Task.Delay(PollInterval, stoppingToken);
            }
        }

        private async Task SendIfDueAsync(CancellationToken stoppingToken)
        {
            var now = DateTime.UtcNow;
            if (now.Hour < ReminderHourUtc) return;

            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var today = CentralTime.Today; // same day boundary as the puzzle itself

            // Cheap pre-check so the ~40 post-send passes per day exit without
            // attempting the insert — EF logs every failed DbCommand at Error
            // level before our catch runs, which was flooding Sentry with a
            // PK-conflict "error" every 10 minutes for the rest of the day.
            if (await db.CineMindReminderLog.AnyAsync(l => l.PuzzleDate == today, stoppingToken))
                return;

            // Claim the day BEFORE sending. If two instances poll at once, the
            // primary-key conflict makes exactly one of them the sender —
            // sending first and recording after would let both fan out.
            var log = new CineMindReminderLog
            {
                PuzzleDate = today,
                SentAt = now,
                RecipientCount = 0,
            };

            try
            {
                db.CineMindReminderLog.Add(log);
                await db.SaveChangesAsync(stoppingToken);
            }
            catch (DbUpdateException)
            {
                // Already sent today, by an earlier pass or another instance.
                db.ChangeTracker.Clear();
                return;
            }

            var playedToday = await db.UserDailyProgress
                .Where(p => p.PuzzleDate == today)
                .Select(p => p.UserId)
                .ToListAsync(stoppingToken);

            // Everyone who has ever played, minus everyone already done today.
            var lapsed = await db.UserDailyProgress
                .Where(p => p.PuzzleDate != today)
                .Select(p => p.UserId)
                .Distinct()
                .ToListAsync(stoppingToken);

            var recipients = lapsed.Except(playedToday).ToList();
            if (recipients.Count == 0)
            {
                _logger.LogInformation("CineMind reminder {Date}: nobody to remind.", today);
                return;
            }

            var sent = await _push.NotifyUsersAsync(
                db,
                recipients,
                "🧠 Today's CineMind is ready",
                "Three challenges, one shot. Keep your streak alive.",
                PushRules.TypeOnlyData("cinemind_reminder"));

            log.RecipientCount = sent;
            await db.SaveChangesAsync(stoppingToken);

            _logger.LogInformation(
                "CineMind reminder {Date}: pushed to {Sent} of {Eligible} eligible players.",
                today, sent, recipients.Count);
        }
    }
}
