namespace Backend.Services
{
    // The showtimes pipeline stores wall-clock times as theater-local
    // ("Central") values. These conversions must go through the real
    // America/Chicago zone: a fixed UTC-6 is wrong for the eight months
    // Central observes daylight saving (UTC-5), which made "hide showings
    // that already started" run an hour late in summer.
    public static class CentralTime
    {
        private static readonly TimeZoneInfo Zone =
            TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");

        public static DateTime Now =>
            TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Zone);

        public static DateOnly Today => DateOnly.FromDateTime(Now);
    }
}
