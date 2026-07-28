using System.Net;
using System.Text.RegularExpressions;

namespace Backend.Services
{
    // Cleanup for strings coming out of the Apify dataset.
    //
    // The actor emits HTML entities raw, and — confirmed live — sometimes
    // MALFORMED ones missing the trailing semicolon: AMC's "Dine‑In" arrives
    // as "Dine&#8209In". WebUtility.HtmlDecode alone will not touch that,
    // because "&#8209In" isn't a well-formed entity. The result is a stored
    // theater name that can never match CinemaClock's own directory name
    // (parsed from real HTML, so properly decoded), which silently breaks
    // exact theater matching, the city backfill, and freshness stamping.
    public static class ScrapedText
    {
        // Numeric entities, semicolon optional — the semicolon-less form is
        // what the actor actually produces.
        private static readonly Regex DecimalEntity = new(@"&#(\d{2,7});?", RegexOptions.Compiled);
        private static readonly Regex HexEntity = new(@"&#[xX]([0-9a-fA-F]{2,6});?", RegexOptions.Compiled);
        private static readonly Regex Whitespace = new(@"\s+", RegexOptions.Compiled);

        public static string Decode(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return string.Empty;

            var decoded = HexEntity.Replace(value, m => SafeChar(Convert.ToInt32(m.Groups[1].Value, 16)));
            decoded = DecimalEntity.Replace(decoded, m =>
                int.TryParse(m.Groups[1].Value, out var code) ? SafeChar(code) : m.Value);

            // Named entities (&nbsp;, &amp;) — these the framework handles.
            decoded = WebUtility.HtmlDecode(decoded);

            // A decoded &nbsp; is U+00A0, not a normal space; collapse all
            // whitespace variants so comparisons don't hinge on which kind.
            return Whitespace.Replace(decoded.Replace(' ', ' '), " ").Trim();
        }

        // Case/whitespace/entity-insensitive key for comparing a scraped
        // theater name against a directory name. Deliberately preserves
        // digits — "AMC Grapevine 30" and "AMC Grapevine 12" are different
        // venues — so this is a normalization, not a fuzzy match.
        public static string ComparisonKey(string? value) => Decode(value).ToLowerInvariant();

        public static bool SameTheater(string? a, string? b) =>
            ComparisonKey(a).Length > 0 && ComparisonKey(a) == ComparisonKey(b);

        private static string SafeChar(int codePoint)
        {
            try
            {
                return char.ConvertFromUtf32(codePoint);
            }
            catch (ArgumentOutOfRangeException)
            {
                return string.Empty; // not a valid Unicode code point
            }
        }
    }
}
