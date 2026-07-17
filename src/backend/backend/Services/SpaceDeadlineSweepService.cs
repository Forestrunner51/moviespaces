using Backend.Data;
using Microsoft.EntityFrameworkCore;

namespace Backend.Services
{
    // Periodically fails any space whose deadline has passed without hitting
    // its funding goal, and releases all its authorized Stripe holds.
    public class SpaceDeadlineSweepService : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<SpaceDeadlineSweepService> _logger;
        private static readonly TimeSpan Interval = TimeSpan.FromMinutes(5);

        public SpaceDeadlineSweepService(IServiceScopeFactory scopeFactory, ILogger<SpaceDeadlineSweepService> logger)
        {
            _scopeFactory = scopeFactory;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await SweepOnceAsync(stoppingToken);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Space deadline sweep failed.");
                }

                try
                {
                    await Task.Delay(Interval, stoppingToken);
                }
                catch (TaskCanceledException)
                {
                    // Shutting down.
                }
            }
        }

        private async Task SweepOnceAsync(CancellationToken stoppingToken)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var settlement = scope.ServiceProvider.GetRequiredService<PledgeSettlementService>();

            var expiredSpaceIds = await db.Spaces
                .Where(s => s.Status == "funding" && s.Deadline < DateTime.UtcNow)
                .Select(s => s.Id)
                .ToListAsync(stoppingToken);

            foreach (var spaceId in expiredSpaceIds)
            {
                // Conditional update guards against a race with a pledge that
                // crosses the goal at the same moment — only one of "flip to
                // failed" or "flip to successful" can win.
                var rowsUpdated = await db.Spaces
                    .Where(s => s.Id == spaceId && s.Status == "funding")
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(s => s.Status, "failed")
                        .SetProperty(s => s.UpdatedAt, DateTime.UtcNow), stoppingToken);

                if (rowsUpdated > 0)
                {
                    _logger.LogInformation("Space {SpaceId} missed its funding deadline — releasing its pledges.", spaceId);
                    await settlement.ReleaseAllAsync(spaceId);
                }
            }
        }
    }
}
