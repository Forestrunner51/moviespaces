using System.Text;
using System.Text.RegularExpressions;

namespace Backend.Services
{
    // Reconciles the two different names the same building has in our two
    // data sources:
    //   Google Places (what the host picks in create-space): "AMC Empire 25"
    //   CinemaClock  (what the scraper stores):              "AMC Empire 25 DINE-IN"
    //
    // Strategy is normalize-then-fuzzy: strip the marketing/format noise that
    // differs between sources, compare exactly, and only fall back to edit
    // distance when that fails. Done in C# rather than via Postgres pg_trgm so
    // this doesn't depend on an extension being enabled on the Render DB.
    public static class TheaterNameMatcher
    {
        // Format/branding tokens that one source includes and the other
        // doesn't. Order matters only for multi-word entries, which are
        // removed before single words.
        private static readonly string[] NoiseTokens =
        {
            "dine in", "dine-in", "digital cinema", "grand screen",
            "imax", "xd", "4dx", "3d", "rpx", "dolby", "dolby cinema",
            "luxe", "prime", "vip", "recliner", "recliners",
            "cinemas", "cinema", "theatres", "theatre", "theaters", "theater",
            "movies", "cineplex", "multiplex", "the",
        };

        private static readonly Regex NonAlphanumeric = new(@"[^a-z0-9 ]", RegexOptions.Compiled);
        private static readonly Regex StandaloneNumber = new(@"\b\d+\b", RegexOptions.Compiled);
        private static readonly Regex Whitespace = new(@"\s+", RegexOptions.Compiled);

        // Lowercase, strip accents ("Cinépolis" -> "cinepolis"), drop
        // punctuation, remove format/branding noise, and drop standalone
        // numbers — screen counts routinely differ between the two sources
        // ("AMC NorthPark 15" vs "AMC NorthPark").
        public static string Normalize(string? name)
        {
            if (string.IsNullOrWhiteSpace(name)) return string.Empty;

            var lowered = RemoveDiacritics(name).ToLowerInvariant();
            var cleaned = NonAlphanumeric.Replace(lowered, " ");
            cleaned = Whitespace.Replace(cleaned, " ").Trim();

            foreach (var token in NoiseTokens)
            {
                cleaned = Regex.Replace(cleaned, $@"\b{Regex.Escape(token)}\b", " ");
            }

            cleaned = StandaloneNumber.Replace(cleaned, " ");
            return Whitespace.Replace(cleaned, " ").Trim();
        }

        // 0.0–1.0 similarity on the normalized forms. 1.0 is an exact match
        // after normalization; anything below ~0.8 is usually a different
        // venue and should not be auto-matched.
        public static double Similarity(string? a, string? b)
        {
            var left = Normalize(a);
            var right = Normalize(b);
            if (left.Length == 0 || right.Length == 0) return 0;
            if (left == right) return 1.0;

            // One name fully containing the other is a strong signal that
            // survives normalization gaps ("amc empire" vs "amc empire dine").
            if (left.Contains(right, StringComparison.Ordinal)
                || right.Contains(left, StringComparison.Ordinal))
            {
                return 0.95;
            }

            var distance = Levenshtein(left, right);
            var longest = Math.Max(left.Length, right.Length);
            return 1.0 - ((double)distance / longest);
        }

        // Picks the best candidate above `threshold`, or null when nothing is
        // close enough — returning a wrong theater's showtimes is worse than
        // returning none and falling back to the Google redirect.
        public static string? BestMatch(string target, IEnumerable<string> candidates, double threshold = 0.8)
        {
            string? best = null;
            double bestScore = 0;

            foreach (var candidate in candidates)
            {
                var score = Similarity(target, candidate);
                if (score > bestScore)
                {
                    bestScore = score;
                    best = candidate;
                }
            }

            return bestScore >= threshold ? best : null;
        }

        private static string RemoveDiacritics(string text)
        {
            var normalized = text.Normalize(NormalizationForm.FormD);
            var builder = new StringBuilder(normalized.Length);
            foreach (var c in normalized)
            {
                if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c)
                    != System.Globalization.UnicodeCategory.NonSpacingMark)
                {
                    builder.Append(c);
                }
            }
            return builder.ToString().Normalize(NormalizationForm.FormC);
        }

        // Iterative two-row Levenshtein — the full matrix is unnecessary here
        // and these strings are short.
        private static int Levenshtein(string a, string b)
        {
            var previous = new int[b.Length + 1];
            var current = new int[b.Length + 1];

            for (var j = 0; j <= b.Length; j++) previous[j] = j;

            for (var i = 1; i <= a.Length; i++)
            {
                current[0] = i;
                for (var j = 1; j <= b.Length; j++)
                {
                    var cost = a[i - 1] == b[j - 1] ? 0 : 1;
                    current[j] = Math.Min(
                        Math.Min(current[j - 1] + 1, previous[j] + 1),
                        previous[j - 1] + cost);
                }
                (previous, current) = (current, previous);
            }

            return previous[b.Length];
        }
    }
}
