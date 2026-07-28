namespace Backend.Services
{
    // Maps an arbitrary user city to one of the metro slugs the CinemaClock
    // actor accepts.
    //
    // The scraper works per-metro, not per-suburb: someone in Frisco or
    // Arlington still goes to DFW theaters, so they must resolve to "dallas"
    // rather than triggering a useless (and billable) scrape of their own
    // town. State/province is used to disambiguate names that repeat across
    // metros ("Arlington" is a DFW suburb; "Vancouver" is both Washington
    // state and British Columbia).
    //
    // The 30 slugs below are the actor's CONFIRMED allowed values (from its
    // JSON schema validation error) — this is not a guess. An unrecognised
    // slug produces a run that succeeds with zero rows, which looks identical
    // to "no showtimes" from the outside, so this list must never drift from
    // the actor's real schema without re-confirming it.
    public static class MetroAreas
    {
        // A metro can span more than one state/province (Portland, OR /
        // Vancouver, WA is one media market straddling a state line), so
        // disambiguation checks membership in this list, not equality against
        // a single anchor.
        public record Metro(string Slug, string TimeZoneId, string[] States, string[] Cities);

        private static readonly Metro[] All =
        {
            // ── US ──────────────────────────────────────────────────────
            new("new-york", "America/New_York", new[] { "NY", "NJ" }, new[]
                { "new york", "brooklyn", "queens", "bronx", "staten island", "yonkers", "newark",
                  "jersey city", "hoboken", "white plains", "new rochelle" }),
            new("los-angeles", "America/Los_Angeles", new[] { "CA" }, new[]
                { "los angeles", "pasadena", "long beach", "anaheim", "santa monica", "burbank",
                  "glendale", "irvine", "santa ana", "torrance", "inglewood", "culver city" }),
            new("chicago", "America/Chicago", new[] { "IL" }, new[]
                { "chicago", "naperville", "evanston", "schaumburg", "oak park", "skokie",
                  "aurora", "joliet", "arlington heights" }),
            new("houston", "America/Chicago", new[] { "TX" }, new[]
                { "houston", "sugar land", "katy", "pearland", "the woodlands", "pasadena",
                  "baytown", "conroe", "spring" }),
            new("boston", "America/New_York", new[] { "MA" }, new[]
                { "boston", "cambridge", "somerville", "brookline", "quincy", "newton", "waltham" }),
            new("san-francisco", "America/Los_Angeles", new[] { "CA" }, new[]
                {
                    "san francisco", "oakland", "berkeley", "daly city", "san mateo", "emeryville",
                    // San Jose/South Bay has no slug of its own in the actor's
                    // schema. Folding it in here (rather than dropping it to
                    // "unmapped") is an ASSUMPTION that CinemaClock's
                    // "san-francisco" scrape covers South Bay theaters, the
                    // same way "dallas" is confirmed to cover Fort Worth —
                    // unverified for this specific metro, flag if wrong.
                    "san jose", "santa clara", "sunnyvale", "mountain view", "cupertino",
                    "palo alto", "milpitas", "fremont",
                }),
            new("miami", "America/New_York", new[] { "FL" }, new[]
                { "miami", "fort lauderdale", "hollywood", "coral gables", "hialeah", "aventura",
                  "boca raton", "pembroke pines" }),
            new("seattle", "America/Los_Angeles", new[] { "WA" }, new[]
                { "seattle", "bellevue", "redmond", "kirkland", "renton", "everett", "tacoma", "lynnwood" }),
            new("atlanta", "America/New_York", new[] { "GA" }, new[]
                { "atlanta", "marietta", "alpharetta", "decatur", "sandy springs", "roswell", "duluth" }),
            new("dallas", "America/Chicago", new[] { "TX" }, new[]
                { "dallas", "fort worth", "frisco", "plano", "arlington", "irving", "garland",
                  "mckinney", "denton", "richardson", "grapevine", "allen", "lewisville" }),
            new("philadelphia", "America/New_York", new[] { "PA" }, new[]
                { "philadelphia", "king of prussia", "cherry hill", "camden", "wilmington", "chester" }),
            new("denver", "America/Denver", new[] { "CO" }, new[]
                { "denver", "aurora", "lakewood", "boulder", "littleton", "westminster",
                  "arvada", "centennial", "thornton" }),
            new("phoenix", "America/Phoenix", new[] { "AZ" }, new[]
                { "phoenix", "scottsdale", "tempe", "mesa", "chandler", "gilbert", "glendale",
                  "peoria", "surprise" }),
            new("minneapolis", "America/Chicago", new[] { "MN" }, new[]
                { "minneapolis", "st paul", "saint paul", "bloomington", "edina", "eden prairie", "maple grove" }),
            new("detroit", "America/New_York", new[] { "MI" }, new[]
                { "detroit", "dearborn", "royal oak", "troy", "ann arbor", "livonia", "warren" }),
            // Portland-Vancouver is one cross-river metro/media market — see
            // the "vancouver" ambiguity note below.
            new("portland", "America/Los_Angeles", new[] { "OR", "WA" }, new[]
                { "portland", "beaverton", "hillsboro", "gresham", "tigard", "lake oswego", "vancouver" }),
            new("san-diego", "America/Los_Angeles", new[] { "CA" }, new[]
                { "san diego", "chula vista", "la jolla", "carlsbad", "escondido", "oceanside" }),
            new("austin", "America/Chicago", new[] { "TX" }, new[]
                { "austin", "round rock", "cedar park", "georgetown", "pflugerville", "san marcos" }),
            new("nashville", "America/Chicago", new[] { "TN" }, new[]
                { "nashville", "franklin", "murfreesboro", "brentwood", "hendersonville" }),
            new("charlotte", "America/New_York", new[] { "NC" }, new[]
                { "charlotte", "concord", "huntersville", "matthews", "gastonia" }),
            new("orlando", "America/New_York", new[] { "FL" }, new[]
                { "orlando", "kissimmee", "winter park", "altamonte springs", "sanford" }),
            new("san-antonio", "America/Chicago", new[] { "TX" }, new[]
                { "san antonio", "new braunfels", "schertz", "boerne" }),

            // ── Canada ──────────────────────────────────────────────────
            new("toronto", "America/Toronto", new[] { "ON" }, new[]
                { "toronto", "mississauga", "brampton", "markham", "vaughan", "richmond hill",
                  "oakville", "north york", "scarborough", "etobicoke" }),
            new("montreal", "America/Toronto", new[] { "QC" }, new[]
                { "montreal", "laval", "longueuil", "brossard", "saint-laurent" }),
            // Real ambiguity, not a hypothetical: Vancouver, WA is a top-100
            // US city and part of the Portland metro (see "portland" above).
            // Without a state/province, "vancouver" alone must stay
            // unresolved rather than guess a continent.
            new("vancouver", "America/Vancouver", new[] { "BC" }, new[]
                { "vancouver", "burnaby", "richmond", "surrey", "coquitlam", "north vancouver",
                  "west vancouver", "langley" }),
            new("calgary", "America/Edmonton", new[] { "AB" }, new[] { "calgary", "airdrie" }),
            new("edmonton", "America/Edmonton", new[] { "AB" }, new[]
                { "edmonton", "sherwood park", "st albert" }),
            new("ottawa", "America/Toronto", new[] { "ON" }, new[]
                { "ottawa", "gatineau", "kanata", "nepean" }),
            new("winnipeg", "America/Winnipeg", new[] { "MB" }, new[] { "winnipeg", "headingley" }),
            new("quebec-city", "America/Toronto", new[] { "QC" }, new[]
                { "quebec city", "sainte-foy" }),
        };

        // Keyed by the CANONICAL form, not the raw slug: lookups arrive both
        // hyphenated ("los-angeles", from a stored row) and spaced ("Los
        // Angeles", from a geocoder), and Canonical() folds both to the same
        // string. Keying on the raw slug would miss every multi-word metro.
        private static readonly Dictionary<string, Metro> ByCanonicalSlug =
            All.ToDictionary(m => Canonical(m.Slug), StringComparer.OrdinalIgnoreCase);

        public static IReadOnlyCollection<string> SupportedSlugs =>
            All.Select(m => m.Slug).ToList();

        public static Metro? BySlugOrNull(string? slug) =>
            !string.IsNullOrWhiteSpace(slug) && ByCanonicalSlug.TryGetValue(Canonical(slug), out var m) ? m : null;

        // Resolves a user's city (and optional state/province) to a supported
        // metro slug, or null when we don't cover their area — in which case
        // the caller must fall back to the Google deep link rather than burn a
        // scrape on a metro the actor can't serve.
        //
        // State matters: "Arlington" is a DFW suburb, "Glendale" is both LA
        // and Phoenix, "Aurora" is both Denver and Chicago, "Pasadena" is both
        // LA and Houston, and "Vancouver" is both Washington state and
        // British Columbia. Where a city name is ambiguous we require the
        // state/province to agree; without one we refuse rather than guess,
        // since guessing wrong scrapes the wrong metro (or the wrong country).
        public static string? Resolve(string? city, string? state = null)
        {
            if (string.IsNullOrWhiteSpace(city)) return null;
            var key = Canonical(city);

            // A metro's own slug is one candidate among others, NOT an
            // automatic shortcut — "vancouver" is simultaneously the Canadian
            // metro's slug AND a city name that also appears in Portland's
            // suburb list (Vancouver, WA). Resolving the slug match first,
            // unconditionally, would silently defeat that disambiguation:
            // "Vancouver, WA" would resolve to the vancouver-BC slug before
            // the state was ever consulted. So every metro whose slug or
            // city list contains this name is gathered into ONE set and the
            // same single-vs-ambiguous logic runs over all of them.
            var matches = All
                .Where(m => Canonical(m.Slug) == key || m.Cities.Contains(key, StringComparer.OrdinalIgnoreCase))
                .Distinct()
                .ToList();

            if (matches.Count == 0) return null;
            if (matches.Count == 1) return matches[0].Slug;

            // Ambiguous city name — only a matching state/province can
            // disambiguate. Membership, not equality: a metro can list more
            // than one state (Portland/Vancouver WA spans OR and WA).
            var normalizedState = NormalizeState(state);
            if (normalizedState == null) return null;
            return matches.FirstOrDefault(m =>
                m.States.Contains(normalizedState, StringComparer.OrdinalIgnoreCase))?.Slug;
        }

        // The timezone of the metro, used to decide whether a scraped
        // wall-clock showtime has already passed.
        public static TimeZoneInfo? TimeZoneFor(string? slug)
        {
            var metro = BySlugOrNull(slug);
            if (metro == null) return null;
            try { return TimeZoneInfo.FindSystemTimeZoneById(metro.TimeZoneId); }
            catch (Exception) { return null; }
        }

        // Slugs are hyphenated ("los-angeles") but user cities and scraped
        // values arrive spaced and inconsistently punctuated ("Los Angeles",
        // "St. Louis"), so everything is compared in one canonical form.
        private static string Canonical(string value) =>
            new string(value.Trim().ToLowerInvariant()
                .Select(c => c == '-' || c == '_' ? ' ' : c)
                .Where(c => char.IsLetterOrDigit(c) || c == ' ')
                .ToArray())
            .Replace("  ", " ")
            .Trim();

        private static string? NormalizeState(string? state)
        {
            if (string.IsNullOrWhiteSpace(state)) return null;
            var s = state.Trim();
            if (s.Length == 2) return s.ToUpperInvariant();

            return s.ToLowerInvariant() switch
            {
                // US
                "new york" => "NY", "new jersey" => "NJ", "california" => "CA", "illinois" => "IL",
                "texas" => "TX", "pennsylvania" => "PA", "massachusetts" => "MA", "georgia" => "GA",
                "florida" => "FL", "arizona" => "AZ", "colorado" => "CO", "washington" => "WA",
                "oregon" => "OR", "michigan" => "MI", "minnesota" => "MN", "north carolina" => "NC",
                "tennessee" => "TN",
                // Canada
                "ontario" => "ON", "quebec" => "QC", "british columbia" => "BC", "alberta" => "AB",
                "manitoba" => "MB",
                _ => null,
            };
        }
    }
}
