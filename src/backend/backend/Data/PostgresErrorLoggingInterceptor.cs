using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;

namespace Backend.Data
{
    // Turns the redacted "DbUpdateException — DETAIL redacted" flood into one
    // actionable line. Npgsql hides the DETAIL (which contains actual row
    // values) by default, and we keep it that way — but the SqlState,
    // failing table, constraint, and column on the PostgresException are just
    // schema metadata, safe to log, and they're exactly what identifies a
    // failing write. This fires for EVERY SaveChanges failure regardless of
    // where the calling code catches it, so it covers every write path at once
    // (the scraper, the CineMind first-seen insert, etc.) without touching
    // each catch site. Logged at Warning: this only describes the failure; the
    // write's own handler still decides whether it's fatal or an expected race.
    public sealed class PostgresErrorLoggingInterceptor : SaveChangesInterceptor
    {
        private readonly ILogger<PostgresErrorLoggingInterceptor> _logger;

        public PostgresErrorLoggingInterceptor(ILogger<PostgresErrorLoggingInterceptor> logger)
        {
            _logger = logger;
        }

        public override void SaveChangesFailed(DbContextErrorEventData eventData)
        {
            Describe(eventData.Exception);
        }

        public override Task SaveChangesFailedAsync(
            DbContextErrorEventData eventData,
            CancellationToken cancellationToken = default)
        {
            Describe(eventData.Exception);
            return Task.CompletedTask;
        }

        private void Describe(Exception exception)
        {
            // EF wraps the driver error: DbUpdateException → PostgresException.
            if (exception.InnerException is PostgresException pg)
            {
                _logger.LogWarning(
                    "SaveChanges failed: SqlState={SqlState} Table={Table} Constraint={Constraint} Column={Column} Message={Message}",
                    pg.SqlState,
                    string.IsNullOrEmpty(pg.TableName) ? "(none)" : pg.TableName,
                    string.IsNullOrEmpty(pg.ConstraintName) ? "(none)" : pg.ConstraintName,
                    string.IsNullOrEmpty(pg.ColumnName) ? "(none)" : pg.ColumnName,
                    pg.MessageText);
            }
            else
            {
                _logger.LogWarning(
                    exception,
                    "SaveChanges failed with a non-Postgres error ({Type}).",
                    exception.GetType().Name);
            }
        }
    }
}
