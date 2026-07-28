using System.Collections.Concurrent;

namespace Backend.Services
{
    // Maps the scraper's city field ("dallas") to a real timezone, so we can
    // tell whether a showtime has actually passed.
    //
    // Scraped showtimes are local wall-clock with no offset (see the Showtime
    // model), which makes "is this in the past?" unanswerable by comparing to
    // UTC. Rather than convert the showtime to an instant — impossible, we
    // don't know its offset — we convert *now* into the theater's local wall
    // clock and compare wall-clock to wall-clock.
    //
    // IANA ids (not fixed offsets) so DST is handled automatically: "2:00 PM
    // in Dallas" is a different instant in July than in January, and
    // TimeZoneInfo knows that. .NET resolves IANA ids via ICU on Linux/macOS,
    // which covers both Render and local dev.
    public static class CityTimeZones
    {
        // Deliberately excludes genuinely ambiguous city names that straddle
        // zones — "Glendale" (AZ/CA), "Aurora" (CO/IL), "Springfield"
        // (everywhere). Those fall through to the lenient path rather than
        // risk shifting showtimes by an hour or more in the wrong direction.
        private static readonly Dictionary<string, string> ZoneIdByCity = new(StringComparer.OrdinalIgnoreCase)
        {
            // ── US Eastern ──────────────────────────────────────────────
            ["new york"] = "America/New_York",
            ["brooklyn"] = "America/New_York",
            ["queens"] = "America/New_York",
            ["bronx"] = "America/New_York",
            ["boston"] = "America/New_York",
            ["philadelphia"] = "America/New_York",
            ["washington"] = "America/New_York",
            ["atlanta"] = "America/New_York",
            ["miami"] = "America/New_York",
            ["orlando"] = "America/New_York",
            ["tampa"] = "America/New_York",
            ["jacksonville"] = "America/New_York",
            ["charlotte"] = "America/New_York",
            ["raleigh"] = "America/New_York",
            ["pittsburgh"] = "America/New_York",
            ["cleveland"] = "America/New_York",
            ["columbus"] = "America/New_York",
            ["cincinnati"] = "America/New_York",
            ["detroit"] = "America/New_York",
            ["baltimore"] = "America/New_York",
            ["buffalo"] = "America/New_York",
            ["richmond"] = "America/New_York",
            ["hartford"] = "America/New_York",
            ["providence"] = "America/New_York",
            ["newark"] = "America/New_York",
            ["indianapolis"] = "America/Indiana/Indianapolis",
            ["louisville"] = "America/Kentucky/Louisville",

            // ── US Central ──────────────────────────────────────────────
            ["chicago"] = "America/Chicago",
            ["dallas"] = "America/Chicago",
            ["fort worth"] = "America/Chicago",
            ["houston"] = "America/Chicago",
            ["austin"] = "America/Chicago",
            ["san antonio"] = "America/Chicago",
            ["minneapolis"] = "America/Chicago",
            ["saint paul"] = "America/Chicago",
            ["st louis"] = "America/Chicago",
            ["saint louis"] = "America/Chicago",
            ["kansas city"] = "America/Chicago",
            ["milwaukee"] = "America/Chicago",
            ["madison"] = "America/Chicago",
            ["new orleans"] = "America/Chicago",
            ["memphis"] = "America/Chicago",
            ["nashville"] = "America/Chicago",
            ["oklahoma city"] = "America/Chicago",
            ["tulsa"] = "America/Chicago",
            ["omaha"] = "America/Chicago",
            ["des moines"] = "America/Chicago",
            ["little rock"] = "America/Chicago",
            ["wichita"] = "America/Chicago",

            // ── US Mountain ─────────────────────────────────────────────
            ["denver"] = "America/Denver",
            ["colorado springs"] = "America/Denver",
            ["salt lake city"] = "America/Denver",
            ["albuquerque"] = "America/Denver",
            ["boise"] = "America/Boise",
            ["billings"] = "America/Denver",
            ["cheyenne"] = "America/Denver",
            ["el paso"] = "America/Denver",

            // Arizona does not observe DST — a fixed Mountain mapping would
            // be an hour off for ~8 months of the year.
            ["phoenix"] = "America/Phoenix",
            ["tucson"] = "America/Phoenix",
            ["mesa"] = "America/Phoenix",
            ["scottsdale"] = "America/Phoenix",
            ["tempe"] = "America/Phoenix",
            ["chandler"] = "America/Phoenix",

            // ── US Pacific ──────────────────────────────────────────────
            ["los angeles"] = "America/Los_Angeles",
            ["san francisco"] = "America/Los_Angeles",
            ["san diego"] = "America/Los_Angeles",
            ["san jose"] = "America/Los_Angeles",
            ["oakland"] = "America/Los_Angeles",
            ["sacramento"] = "America/Los_Angeles",
            ["fresno"] = "America/Los_Angeles",
            ["long beach"] = "America/Los_Angeles",
            ["anaheim"] = "America/Los_Angeles",
            ["santa ana"] = "America/Los_Angeles",
            ["irvine"] = "America/Los_Angeles",
            ["riverside"] = "America/Los_Angeles",
            ["bakersfield"] = "America/Los_Angeles",
            ["seattle"] = "America/Los_Angeles",
            ["tacoma"] = "America/Los_Angeles",
            ["spokane"] = "America/Los_Angeles",
            ["portland"] = "America/Los_Angeles", // OR; Portland ME is far smaller
            ["las vegas"] = "America/Los_Angeles",
            ["reno"] = "America/Los_Angeles",

            // ── US non-contiguous ───────────────────────────────────────
            ["anchorage"] = "America/Anchorage",
            ["honolulu"] = "Pacific/Honolulu",

            // ── Canada (CinemaClock's original market) ──────────────────
            ["toronto"] = "America/Toronto",
            ["ottawa"] = "America/Toronto",
            ["montreal"] = "America/Toronto",
            ["quebec"] = "America/Toronto",
            ["hamilton"] = "America/Toronto",
            ["winnipeg"] = "America/Winnipeg",
            ["calgary"] = "America/Edmonton",
            ["edmonton"] = "America/Edmonton",
            ["vancouver"] = "America/Vancouver",
            ["victoria"] = "America/Vancouver",
            ["halifax"] = "America/Halifax",
        };

        // TimeZoneInfo lookups hit the OS tz database, so resolved zones are
        // cached — this runs per showtime row on every read.
        private static readonly ConcurrentDictionary<string, TimeZoneInfo?> Cache = new();

        public static TimeZoneInfo? Resolve(string? city)
        {
            if (string.IsNullOrWhiteSpace(city)) return null;
            var key = city.Trim();

            return Cache.GetOrAdd(key, static k =>
            {
                if (!ZoneIdByCity.TryGetValue(k, out var zoneId)) return null;
                try
                {
                    return TimeZoneInfo.FindSystemTimeZoneById(zoneId);
                }
                catch (Exception)
                {
                    // Missing tz database entry — treat as unknown rather than
                    // failing the whole request.
                    return null;
                }
            });
        }

        // "Now", expressed as the wall clock a moviegoer in that city would
        // read — directly comparable to a scraped showtime. Null when the city
        // isn't mapped, so callers can fall back rather than guess.
        public static DateTime? NowInCity(string? city)
        {
            var zone = Resolve(city);
            if (zone == null) return null;
            return DateTime.SpecifyKind(
                TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone),
                DateTimeKind.Unspecified);
        }
    }
}
