using Microsoft.EntityFrameworkCore;
using Backend.Data;

namespace Backend.Services
{
    // Polls for Spaces whose ScreeningTime is about 2 hours out and sends a
    // one-time "starting soon" push to every member. Only Spaces with a real
    // ScreeningTime can be reminded — legacy/manually-typed showtimes have no
    // parseable date and are silently skipped, same as the calendar-add flow.
    public class ReminderBackgroundService : BackgroundService
    {
        private static readonly TimeSpan PollInterval = TimeSpan.FromMinutes(5);
        // A Space qualifies once its ScreeningTime falls within this lead-time
        // window ahead of "now" — sized to match PollInterval so no Space is
        // polled past without ever landing in the window.
        private static readonly TimeSpan LeadTimeMax = TimeSpan.FromHours(2);
        private static readonly TimeSpan LeadTimeMin = TimeSpan.FromHours(2) - TimeSpan.FromMinutes(5);

        private readonly IServiceScopeFactory _scopeFactory;
        private readonly PushNotificationService _pushNotificationService;
        private readonly ILogger<ReminderBackgroundService> _logger;

        public ReminderBackgroundService(
            IServiceScopeFactory scopeFactory,
            PushNotificationService pushNotificationService,
            ILogger<ReminderBackgroundService> logger)
        {
            _scopeFactory = scopeFactory;
            _pushNotificationService = pushNotificationService;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await SendDueRemindersAsync(stoppingToken);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Reminder background service pass failed.");
                }

                await Task.Delay(PollInterval, stoppingToken);
            }
        }

        private async Task SendDueRemindersAsync(CancellationToken stoppingToken)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var now = DateTime.UtcNow;
            var windowStart = now + LeadTimeMin;
            var windowEnd = now + LeadTimeMax;

            var dueGroups = await db.Groups
                .Where(g => !g.ReminderSent
                    && g.Status != "cancelled"
                    && g.ScreeningTime != null
                    && g.ScreeningTime >= windowStart
                    && g.ScreeningTime <= windowEnd)
                .ToListAsync(stoppingToken);

            foreach (var group in dueGroups)
            {
                await _pushNotificationService.NotifyMembersAsync(
                    db,
                    group.Id,
                    "🍿 Starting soon!",
                    $"{group.FilmName} at {group.CinemaName} starts in about 2 hours."
                );

                group.ReminderSent = true;
            }

            if (dueGroups.Count > 0)
            {
                await db.SaveChangesAsync(stoppingToken);
            }
        }
    }
}
