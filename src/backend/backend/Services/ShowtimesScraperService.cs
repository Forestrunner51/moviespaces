using System.Text.Json;
using System.Text.RegularExpressions;
using Backend.Models;
using HtmlAgilityPack;

namespace Backend.Services
{
    // Scrapes public showtimes listings from cinemaclock.com for one metro
    // area (config: Showtimes:City, e.g. "dallas-tx").
    //
    // WHY SCRAPING: there is no free licensed US showtimes API (AMC's catalog
    // API is the eventual replacement once its vendor key activates — see
    // DebugController). Cinema Clock was chosen deliberately: its theater
    // pages are fully server-rendered (no headless browser needed), its
    // robots.txt permits general crawlers on these paths (only /aw/* is
    // disallowed), and its markup carries machine-readable attributes
    // (data-time="1330") that survive cosmetic redesigns better than visual
    // text. We fetch each theater page ONCE per night with a multi-second
    // delay between requests — less traffic than a single human visitor.
    //
    // KNOWN TRADE-OFFS, accepted by the owner: the site's markup can change
    // and silently break parsing (the nightly run logs per-theater failures
    // so a total break is visible in logs, and the app's host-entry flow is
    // the permanent fallback); scraping a third-party site sits in a ToS gray
    // zone. Structure changes here should keep BOTH parse paths (JSON-LD for
    // theater identity, DOM for showtimes) as decoupled pure functions so the
    // fixture tests in backend.Tests keep pinning the contract.
    public class ShowtimesScraperService
    {
        public const string BaseUrl = "https://www.cinemaclock.com";

        // A real browser UA: the site serves the same public HTML either way,
        // but default HttpClient UAs get bot-filtered by CDNs. We are not
        // evading a block aimed at us — the same pages 200 for any browser.
        private const string UserAgent =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

        private static readonly TimeSpan BetweenRequests = TimeSpan.FromSeconds(3);

        private readonly IHttpClientFactory _httpClientFactory;
        private readonly ILogger<ShowtimesScraperService> _logger;

        public ShowtimesScraperService(
            IHttpClientFactory httpClientFactory,
            ILogger<ShowtimesScraperService> logger)
        {
            _httpClientFactory = httpClientFactory;
            _logger = logger;
        }

        public record TheaterShowtimes(
            string TheaterSlug,
            string TheaterName,
            double? Latitude,
            double? Longitude,
            List<ParsedShowing> Showings);

        public record ParsedShowing(string MovieTitle, string MovieSlug, DateOnly ShowDate, int StartMinutes);

        // Fetches the metro's theater directory and returns the theater page
        // slugs, e.g. ["cinemark-legacy-xd", ...]. MaxTheaters caps a runaway
        // directory (site redesign turning nav links into matches) rather
        // than any expected real count.
        public async Task<List<string>> FetchTheaterSlugsAsync(string city, int maxTheaters, CancellationToken ct)
        {
            var html = await FetchAsync($"{BaseUrl}/{city}/movie-theaters", ct);
            return ParseTheaterSlugs(html).Take(maxTheaters).ToList();
        }

        public async Task<TheaterShowtimes?> FetchTheaterAsync(string slug, DateOnly today, CancellationToken ct)
        {
            var html = await FetchAsync($"{BaseUrl}/movie-theaters/{slug}", ct);
            return ParseTheaterPage(slug, html, today);
        }

        public Task DelayBetweenRequestsAsync(CancellationToken ct) => Task.Delay(BetweenRequests, ct);

        private async Task<string> FetchAsync(string url, CancellationToken ct)
        {
            var client = _httpClientFactory.CreateClient();
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.TryAddWithoutValidation("User-Agent", UserAgent);
            request.Headers.TryAddWithoutValidation("Accept", "text/html");
            using var response = await client.SendAsync(request, ct);
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadAsStringAsync(ct);
        }

        // ── Pure parsing (unit-tested against fixtures) ─────────────────────

        public static List<string> ParseTheaterSlugs(string html)
        {
            var doc = new HtmlDocument();
            doc.LoadHtml(html);
            var links = doc.DocumentNode.SelectNodes("//a[starts-with(@href, '/movie-theaters/')]");
            if (links == null) return new List<string>();

            return links
                .Select(a => a.GetAttributeValue("href", ""))
                .Select(href => href.Substring("/movie-theaters/".Length).Trim('/'))
                .Where(slug => slug.Length > 0 && !slug.Contains('/'))
                .Distinct()
                .ToList();
        }

        public static TheaterShowtimes? ParseTheaterPage(string slug, string html, DateOnly today)
        {
            var doc = new HtmlDocument();
            doc.LoadHtml(html);

            var (name, lat, lng) = ParseTheaterJsonLd(html);
            if (string.IsNullOrWhiteSpace(name))
            {
                // No MovieTheater JSON-LD block — either not a theater page or
                // the site restructured. Treat as unparseable, not empty.
                return null;
            }

            var showings = new List<ParsedShowing>();

            // Page layout: each movie is a div.moviedesc (title inside
            // h3.movietitle > a[href=/movies/<slug>]) followed — as later
            // siblings, before the next moviedesc — by div.filall blocks
            // holding that movie's day-by-day showtimes. Walking the document
            // in order and tracking the "current movie" mirrors that layout
            // without depending on the exact wrapper nesting.
            var nodes = doc.DocumentNode.SelectNodes(
                "//div[contains(@class,'moviedesc')] | //div[contains(@class,'filall')]");
            if (nodes == null) return new TheaterShowtimes(slug, name!, lat, lng, showings);

            string currentTitle = "";
            string currentSlug = "";
            foreach (var node in nodes)
            {
                if (node.HasClass("moviedesc"))
                {
                    var titleLink = node.SelectSingleNode(".//h3[contains(@class,'movietitle')]/a");
                    currentTitle = HtmlEntity.DeEntitize(titleLink?.InnerText ?? "").Trim();
                    var href = titleLink?.GetAttributeValue("href", "") ?? "";
                    currentSlug = href.StartsWith("/movies/") ? href.Substring("/movies/".Length).Trim('/') : "";
                    continue;
                }

                if (currentTitle.Length == 0) continue;

                foreach (var (date, minutes) in ParseDaySections(node, today))
                {
                    showings.Add(new ParsedShowing(currentTitle, currentSlug, date, minutes));
                }
            }

            return new TheaterShowtimes(slug, name!, lat, lng, showings);
        }

        // Day sections inside a movie's times block: <p class="times"> holds
        // today, and each <s> inside <p class="timesother"> holds one future
        // day. Both shapes carry the date as <span class="timesdate">Aug 15
        // </span> and each showing as <span class="tix" data-time="1330">.
        // data-time is HHMM on a 24h clock — machine-readable, so no am/pm
        // string parsing and no locale trouble.
        private static IEnumerable<(DateOnly Date, int Minutes)> ParseDaySections(HtmlNode filall, DateOnly today)
        {
            var sections = filall.SelectNodes(".//p[contains(@class,'times')] | .//s");
            if (sections == null) yield break;

            foreach (var section in sections)
            {
                // <p class="timesother"> is only a wrapper for the <s> day
                // nodes we also selected — parsing it directly would double-
                // count every future day's times.
                if (section.Name == "p" && section.GetAttributeValue("class", "").Contains("timesother"))
                    continue;

                var dateText = section.SelectSingleNode(".//span[contains(@class,'timesdate')]")?.InnerText?.Trim();
                var date = ResolveDate(dateText, today);
                if (date == null) continue;

                var tixNodes = section.SelectNodes(".//span[contains(@class,'tix')]");
                if (tixNodes == null) continue;

                foreach (var tix in tixNodes)
                {
                    var raw = tix.GetAttributeValue("data-time", "");
                    if (raw.Length is < 3 or > 4 || !int.TryParse(raw, out var hhmm)) continue;
                    var minutes = (hhmm / 100) * 60 + (hhmm % 100);
                    if (minutes is < 0 or >= 1440) continue;
                    yield return (date.Value, minutes);
                }
            }
        }

        // "Aug 15" → the nearest matching calendar date on or after yesterday
        // (yesterday, not today, so a page cached overnight can't flip a
        // late-night listing into next year). Listings only cover ~a week
        // ahead, so nearest-forward is unambiguous.
        public static DateOnly? ResolveDate(string? monthDayText, DateOnly today)
        {
            if (string.IsNullOrWhiteSpace(monthDayText)) return null;
            var m = Regex.Match(monthDayText.Trim(), @"^([A-Za-z]{3,9})\s+(\d{1,2})$");
            if (!m.Success) return null;

            if (!DateTime.TryParseExact(
                    $"{m.Groups[1].Value} {m.Groups[2].Value} 2000",
                    new[] { "MMM d yyyy", "MMMM d yyyy" },
                    System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None,
                    out var parsed))
                return null;

            var candidate = new DateOnly(today.Year, parsed.Month, parsed.Day);
            if (candidate < today.AddDays(-1)) candidate = candidate.AddYears(1);
            return candidate;
        }

        // Theater identity comes from the page's schema.org MovieTheater
        // JSON-LD — a published machine-readable contract, far more stable
        // than any CSS class.
        public static (string? Name, double? Lat, double? Lng) ParseTheaterJsonLd(string html)
        {
            foreach (Match m in Regex.Matches(html,
                @"<script type=""application/ld\+json"">(.*?)</script>", RegexOptions.Singleline))
            {
                try
                {
                    using var doc = JsonDocument.Parse(m.Groups[1].Value);
                    var root = doc.RootElement;
                    if (root.ValueKind != JsonValueKind.Object) continue;
                    if (root.TryGetProperty("@type", out var type) && type.GetString() == "MovieTheater")
                    {
                        string? name = root.TryGetProperty("name", out var n) ? n.GetString() : null;
                        double? lat = null, lng = null;
                        if (root.TryGetProperty("geo", out var geo))
                        {
                            // The site serializes coordinates as strings.
                            if (geo.TryGetProperty("latitude", out var la)
                                && double.TryParse(la.GetString(), System.Globalization.CultureInfo.InvariantCulture, out var laV))
                                lat = laV;
                            if (geo.TryGetProperty("longitude", out var lo)
                                && double.TryParse(lo.GetString(), System.Globalization.CultureInfo.InvariantCulture, out var loV))
                                lng = loV;
                        }
                        return (name, lat, lng);
                    }
                }
                catch (JsonException)
                {
                    // Malformed block — try the next one.
                }
            }
            return (null, null, null);
        }
    }
}
