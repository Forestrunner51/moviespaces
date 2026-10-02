using Microsoft.EntityFrameworkCore;
using Backend.Data;

namespace Backend.Services
{
    // The other half of ReminderBackgroundService. That one says "starting
    // soon" two hours before; this one asks "how was it?" after.
    //
    // WHY IT EXISTS: the app's whole pitch is that you watched something and
    // had nobody to tell. The moment that's most true is the walk to the car,
    // and until now the app went quiet exactly then — the chat that had been
    // planning the night simply stopped. This reopens it at the one moment
    // everyone has the same thing on their mind.
    //
    // The attendance data (EventResponse) is the byproduct. It's genuinely
    // useful — before this, five people joining and one turning up looked
    // identical in the database to five people turning up — but a push that
    // asked "did everyone show?" would read as a register being taken, and
    // get ignored or resented. Ask about the film; learn who was there.
    public class DebriefBackgroundService : BackgroundService
    {
        private static readonly TimeSpan PollInterval = TimeSpan.FromMinutes(15);

        // Three hours after the showtime starts: a feature plus trailers plus
        // credits is a little over two, so this lands while people are
        // heading out or just home, not while they're still in the dark.
        private static readonly TimeSpan AfterShowtime = TimeSpan.FromHours(3);

        // Nothing older than this is worth asking about. A Space that passed
        // while the service was down shouldn't produce a push about a film
        // somebody saw last week — and without this bound, enabling the
        // service would have fired at every historical Space in the table at
        // once.
        private static readonly TimeSpan StaleAfter = TimeSpan.FromHours(20);

        private readonly IServiceScopeFactory _scopeFactory;
        private readonly PushNotificationService _push;
        private readonly ILogger<DebriefBackgroundService> _logger;

        public DebriefBackgroundService(
            IServiceScopeFactory scopeFactory,
            PushNotificationService push,
            ILogger<DebriefBackgroundService> logger)
        {
            _scopeFactory = scopeFactory;
            _push = push;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await SendDueDebriefsAsync(stoppingToken);
                }
                catch (Exception ex) when (!(ex is OperationCanceledException && stoppingToken.IsCancellationRequested))
                {
                    _logger.LogError(ex, "Debrief background service pass failed.");
                }

                await Task.Delay(PollInterval, stoppingToken);
            }
        }

        private async Task SendDueDebriefsAsync(CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var now = DateTime.UtcNow;
            var dueBefore = now - AfterShowtime;
            var dueAfter = now - StaleAfter;

            var due = await db.Groups
                .Where(g => !g.DebriefSent
                    && g.Status != "cancelled"
                    && g.ScreeningTime != null
                    && g.ScreeningTime <= dueBefore
                    && g.ScreeningTime >= dueAfter)
                .ToListAsync(ct);

            foreach (var group in due)
            {
                // Marked before the send, not after. A push that throws
                // halfway through a fan-out would otherwise be retried on the
                // next poll and notify everyone who already got it — and a
                // duplicate "how was it?" is worse than a missing one.
                group.DebriefSent = true;
                await db.SaveChangesAsync(ct);

                await _push.NotifyMembersAsync(
                    db,
                    group.Id,
                    $"🍿 How was {group.FilmName}?",
                    "Say something before everyone forgets. The chat's still open.",
                    data: PushRules.GroupData("group_debrief", group.Id));

                _logger.LogInformation(
                    "Debrief sent for {GroupId} ({Film}).", group.Id, group.FilmName);
            }
        }
    }
}
