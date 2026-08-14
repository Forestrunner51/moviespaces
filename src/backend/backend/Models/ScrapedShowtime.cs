using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Backend.Models
{
    // One movie showing at one theater, scraped nightly from a public
    // showtimes listing (see ShowtimesScraperService). This table is a CACHE:
    // every successful scrape run wipes and refills the affected theaters'
    // rows, so nothing else may write to it and nothing may reference it by
    // FK. Rows denormalize theater metadata on purpose — a separate theaters
    // table would need its own upsert lifecycle for data we re-derive nightly
    // anyway.
    public class ScrapedShowtime
    {
        public int Id { get; set; }

        // e.g. "cinemark-legacy-xd" — the listing site's stable slug, used as
        // the theater's identity across scrape runs.
        [Column("theater_slug")]
        [MaxLength(150)]
        public string TheaterSlug { get; set; } = "";

        [Column("theater_name")]
        [MaxLength(200)]
        public string TheaterName { get; set; } = "";

        [Column("latitude")]
        public double? Latitude { get; set; }

        [Column("longitude")]
        public double? Longitude { get; set; }

        [Column("movie_title")]
        [MaxLength(250)]
        public string MovieTitle { get; set; } = "";

        // The listing site's movie slug (e.g. "agadha-2026") — kept so a
        // future pass can join back to poster/details, and as a stable
        // per-movie key that survives title formatting quirks.
        [Column("movie_slug")]
        [MaxLength(250)]
        public string MovieSlug { get; set; } = "";

        // Local calendar date of the showing (theater-local, not UTC — a
        // 11:30pm showing belongs to the day the audience says it does).
        [Column("show_date")]
        public DateOnly ShowDate { get; set; }

        // Minutes after local midnight (e.g. 13:30 → 810). Stored as minutes
        // rather than a timestamp so no timezone math is baked into rows.
        [Column("start_minutes")]
        public int StartMinutes { get; set; }

        [Column("scraped_at_utc")]
        public DateTime ScrapedAtUtc { get; set; } = DateTime.UtcNow;
    }
}
